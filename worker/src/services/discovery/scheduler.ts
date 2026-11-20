import type { Bindings, DiscoveryScheduledController } from '../../types';
import { getDiscoveryBotSettings, isSourceCircuitOpen } from './botSettingsService';
import { parseDiscoveryConfig } from './config';
import { sanitizeDiscoveryErrorMessage } from './errors';
import {
  countActiveQueuedBacklog,
  createDiscoveryJob,
  enqueueDiscoveryJob,
  recoverStaleRunningJobs,
} from './jobService';

export interface SchedulerRunSummary {
  executed: boolean;
  reason:
    | 'scheduled'
    | 'discovery_disabled'
    | 'scheduler_disabled'
    | 'queue_unbound'
    | 'backlog_limit_reached'
    | 'no_approved_sources';
  cron: string;
  scheduledTime: number;
  utcDateKey: string;
  dryRun: boolean;
  activeBacklogBefore: number;
  recoveredStaleJobIds: string[];
  failedStaleJobIds: string[];
  createdJobIds: string[];
  enqueuedJobIds: string[];
  skippedExistingJobIds: string[];
  errors: string[];
}

function toUtcDateKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function logScheduler(event: string, payload: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      scope: 'discovery.scheduler',
      event,
      timestamp: new Date().toISOString(),
      ...payload,
    }),
  );
}

/**
 * Lightweight Cloudflare Cron Trigger handler (configured at `0 1 * * *` UTC = 02:00 Africa/Lagos).
 * - Disabled by default until BOTH `DISCOVERY_ENABLED="true"` and `DISCOVERY_SCHEDULER_ENABLED="true"`.
 * - Performs ZERO external source HTTP requests directly; only creates idempotent D1 jobs
 *   and enqueues their compact job IDs to `DISCOVERY_QUEUE`.
 * - Enforces `maxJobsPerRun` and `maxQueuedBacklog` to prevent runaway queues.
 */
export async function handleDiscoveryScheduled(
  controller: Pick<DiscoveryScheduledController, 'cron' | 'scheduledTime'>,
  env: Bindings,
  _ctx?: ExecutionContext,
  options: { now?: number } = {},
): Promise<SchedulerRunSummary> {
  const now = options.now ?? controller.scheduledTime ?? Date.now();
  const utcDateKey = toUtcDateKey(now);
  const config = parseDiscoveryConfig(env);

  const baseSummary: SchedulerRunSummary = {
    executed: false,
    reason: 'discovery_disabled',
    cron: controller.cron,
    scheduledTime: controller.scheduledTime,
    utcDateKey,
    dryRun: config.dryRun,
    activeBacklogBefore: 0,
    recoveredStaleJobIds: [],
    failedStaleJobIds: [],
    createdJobIds: [],
    enqueuedJobIds: [],
    skippedExistingJobIds: [],
    errors: [],
  };

  const botSettings = await getDiscoveryBotSettings(env.DB);
  const effectiveMaxJobsPerRun = Math.min(config.maxJobsPerRun, botSettings.dailyJobLimit);

  if (!config.enabled || botSettings.globalPaused || botSettings.discoveryPaused) {
    logScheduler('run.skipped', { reason: 'discovery_disabled', cron: controller.cron, utcDateKey });
    return { ...baseSummary, reason: 'discovery_disabled' };
  }

  if (!config.schedulerEnabled) {
    logScheduler('run.skipped', { reason: 'scheduler_disabled', cron: controller.cron, utcDateKey });
    return { ...baseSummary, reason: 'scheduler_disabled' };
  }

  if (!env.DISCOVERY_QUEUE) {
    logScheduler('run.skipped', { reason: 'queue_unbound', cron: controller.cron, utcDateKey });
    return { ...baseSummary, reason: 'queue_unbound' };
  }

  // 1. Recover any stale interrupted `running` jobs so crashed workers never freeze the pipeline.
  const staleRecovery = await recoverStaleRunningJobs(env.DB, {
    staleTimeoutMs: config.staleJobTimeoutMs,
    maxAttempts: config.maxAttempts,
    limit: config.maxJobsPerRun,
    now,
  });

  // Re-enqueue recovered stale jobs (bounded by maxJobsPerRun).
  const enqueuedJobIds: string[] = [];
  const errors: string[] = [];
  for (const jobId of staleRecovery.requeuedIds) {
    try {
      await enqueueDiscoveryJob(env.DB, env.DISCOVERY_QUEUE, jobId, {
        correlationId: `recover:${utcDateKey}:${jobId}`,
        now,
      });
      enqueuedJobIds.push(jobId);
    } catch (err) {
      errors.push(`recover(${jobId}): ${sanitizeDiscoveryErrorMessage(err, 200)}`);
    }
  }

  // 2. Enforce backlog ceiling so an unhealthy queue never accumulates an invisible backlog.
  const activeBacklogBefore = await countActiveQueuedBacklog(env.DB);
  const remainingBacklogCapacity = Math.max(0, config.maxQueuedBacklog - activeBacklogBefore);
  const remainingRunBudget = Math.max(
    0,
    Math.min(effectiveMaxJobsPerRun - enqueuedJobIds.length, remainingBacklogCapacity),
  );

  if (remainingBacklogCapacity === 0) {
    logScheduler('run.backlog_capped', {
      cron: controller.cron,
      utcDateKey,
      activeBacklogBefore,
      maxQueuedBacklog: config.maxQueuedBacklog,
    });
    return {
      ...baseSummary,
      executed: true,
      reason: 'backlog_limit_reached',
      activeBacklogBefore,
      recoveredStaleJobIds: staleRecovery.requeuedIds,
      failedStaleJobIds: staleRecovery.failedIds,
      enqueuedJobIds,
      errors,
    };
  }

  // 3. Select ONLY approved & enabled sources (ordered by least-recently-synced first).
  const sourcesRes = await env.DB.prepare(
    `SELECT id, name
     FROM discovery_sources
     WHERE permission_status = 'approved' AND enabled = 1
     ORDER BY COALESCE(last_successful_sync, 0) ASC, created_at ASC
     LIMIT ?`,
  )
    .bind(Math.max(1, remainingRunBudget))
    .all<{ id: string; name: string }>();

  const sources = sourcesRes.results ?? [];
  if (sources.length === 0) {
    logScheduler('run.no_sources', { cron: controller.cron, utcDateKey, activeBacklogBefore });
    return {
      ...baseSummary,
      executed: true,
      reason: 'no_approved_sources',
      activeBacklogBefore,
      recoveredStaleJobIds: staleRecovery.requeuedIds,
      failedStaleJobIds: staleRecovery.failedIds,
      enqueuedJobIds,
      errors,
    };
  }

  const createdJobIds: string[] = [];
  const skippedExistingJobIds: string[] = [];

  for (const source of sources) {
    if (enqueuedJobIds.length >= effectiveMaxJobsPerRun) break;

    const circuit = await isSourceCircuitOpen(env.DB, source.id, now);
    if (circuit.open) {
      logScheduler('source.circuit_open', {
        sourceId: source.id,
        openUntil: circuit.openUntil,
      });
      continue;
    }

    const idempotencyKey = `scheduled:${source.id}:state_sweep:${utcDateKey}`;
    try {
      const { job, created } = await createDiscoveryJob(env.DB, {
        sourceId: source.id,
        jobType: 'state_sweep',
        country: 'Nigeria',
        priority: 100,
        idempotencyKey,
        searchParameters: {
          scheduledBy: 'cron',
          cron: controller.cron,
          utcDateKey,
          dryRun: config.dryRun,
        },
        requireApprovedSource: true,
        now,
      });

      if (!created) {
        skippedExistingJobIds.push(job.id);
        continue;
      }

      createdJobIds.push(job.id);
      await enqueueDiscoveryJob(env.DB, env.DISCOVERY_QUEUE, job.id, {
        correlationId: `cron:${utcDateKey}:${job.id}`,
        now,
      });
      enqueuedJobIds.push(job.id);
    } catch (err) {
      errors.push(`source(${source.id}): ${sanitizeDiscoveryErrorMessage(err, 200)}`);
    }
  }

  const summary: SchedulerRunSummary = {
    executed: true,
    reason: 'scheduled',
    cron: controller.cron,
    scheduledTime: controller.scheduledTime,
    utcDateKey,
    dryRun: config.dryRun,
    activeBacklogBefore,
    recoveredStaleJobIds: staleRecovery.requeuedIds,
    failedStaleJobIds: staleRecovery.failedIds,
    createdJobIds,
    enqueuedJobIds,
    skippedExistingJobIds,
    errors,
  };

  logScheduler('run.completed', {
    cron: summary.cron,
    utcDateKey: summary.utcDateKey,
    dryRun: summary.dryRun,
    createdCount: summary.createdJobIds.length,
    enqueuedCount: summary.enqueuedJobIds.length,
    skippedExistingCount: summary.skippedExistingJobIds.length,
    recoveredCount: summary.recoveredStaleJobIds.length,
    errorCount: summary.errors.length,
  });

  return summary;
}
