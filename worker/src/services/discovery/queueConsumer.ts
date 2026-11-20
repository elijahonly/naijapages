import { isDiscoverySourceUsable } from '../../lib/discoveryValidation';
import type {
  Bindings,
  DiscoveryQueueBatch,
  DiscoveryQueueMessageItem,
} from '../../types';
import {
  getDiscoveryBotSettings,
  isSourceCircuitOpen,
  recordSourceCircuitFailure,
  recordSourceCircuitSuccess,
} from './botSettingsService';
import { parseDiscoveryConfig, type DiscoveryRuntimeConfig } from './config';
import { recordCoverageCellScan } from './coverageEngine';
import {
  classifyDiscoveryError,
  computeRetryDelaySeconds,
  DiscoveryJobError,
} from './errors';
import { ingestDiscoveredCandidates } from './ingestion';
import {
  claimDiscoveryJob,
  completeDiscoveryJob,
  failDiscoveryJob,
  type DiscoveryJobCounters,
  type DiscoveryJobRecord,
} from './jobService';
import { validateDiscoveryQueueMessage } from './messages';
import { getDiscoverySourceAdapter } from './sources/registry';
import type { BoundingBox } from './sources/types';

export interface DiscoveryJobExecutionResult {
  counters?: Partial<DiscoveryJobCounters>;
  partial?: boolean;
  note?: string;
}

export interface DiscoveryJobHandlerContext {
  env: Bindings;
  config: DiscoveryRuntimeConfig;
  correlationId: string;
  queueAttempt: number;
  now: number;
  fetchImpl?: typeof fetch;
  skipCache?: boolean;
  source: {
    id: string;
    name: string;
    sourceType: string;
    permissionStatus: string;
    enabled: boolean;
  };
}

export type DiscoveryJobHandler = (
  job: DiscoveryJobRecord,
  context: DiscoveryJobHandlerContext,
) => Promise<DiscoveryJobExecutionResult>;

export type DiscoveryMessageOutcome =
  | 'completed'
  | 'partially_completed'
  | 'skipped_disabled'
  | 'skipped_completed'
  | 'skipped_cancelled'
  | 'skipped_duplicate'
  | 'retried'
  | 'dead_lettered';

export interface DiscoveryMessageResult {
  messageId: string;
  jobId: string | null;
  correlationId: string | null;
  outcome: DiscoveryMessageOutcome;
  errorCode?: string;
  retryDelaySeconds?: number;
}

export interface DiscoveryBatchResult {
  queue: string;
  total: number;
  results: DiscoveryMessageResult[];
}

function parseJobJsonObject(raw: string | null, fieldName: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new DiscoveryJobError(`Discovery job ${fieldName} is not valid JSON.`, {
      kind: 'permanent',
      code: 'INVALID_JOB_PARAMETERS',
      cause: err,
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DiscoveryJobError(`Discovery job ${fieldName} must be a JSON object.`, {
      kind: 'permanent',
      code: 'INVALID_JOB_PARAMETERS',
    });
  }
  return parsed as Record<string, unknown>;
}

function extractBoundingBox(
  geoFilter: Record<string, unknown>,
  searchParams: Record<string, unknown>,
): BoundingBox | undefined {
  const candidate =
    (geoFilter.bbox && typeof geoFilter.bbox === 'object' ? geoFilter.bbox : null) ??
    (searchParams.bbox && typeof searchParams.bbox === 'object' ? searchParams.bbox : null) ??
    ('south' in geoFilter || 'north' in geoFilter ? geoFilter : null);
  if (!candidate || typeof candidate !== 'object') return undefined;
  const raw = candidate as Record<string, unknown>;
  const south = Number(raw.south);
  const west = Number(raw.west);
  const north = Number(raw.north);
  const east = Number(raw.east);
  if (
    !Number.isFinite(south) ||
    !Number.isFinite(west) ||
    !Number.isFinite(north) ||
    !Number.isFinite(east)
  ) {
    return undefined;
  }
  return { south, west, north, east };
}

/**
 * Default discovery job handler.
 * Dispatches to a registered `DiscoverySourceAdapter` (e.g., `openstreetmap_overpass`)
 * when one exists for `job.sourceId`, persisting traceable candidates and append-only
 * evidence into D1 without ever auto-publishing to `businesses`.
 *
 * When no adapter is registered for `job.sourceId`, completes cleanly in bounded no-op
 * orchestration mode (preserving Phase 2 compatibility).
 */
export const defaultDiscoveryJobHandler: DiscoveryJobHandler = async (job, ctx) => {
  const adapter = getDiscoverySourceAdapter(job.sourceId);

  if (!adapter) {
    if (ctx.config.dryRun) {
      return {
        counters: {
          discoveredCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          duplicateCount: 0,
          errorCount: 0,
        },
        note: 'Dry-run orchestration completed (no external source requests executed).',
      };
    }

    return {
      counters: {
        discoveredCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        duplicateCount: 0,
        errorCount: 0,
      },
      note: 'Orchestration dispatched with no source connector registered for this source.',
    };
  }

  const geoFilter = parseJobJsonObject(job.geographicFilterJson, 'geographic_filter_json');
  const searchParams = parseJobJsonObject(job.searchParametersJson, 'search_parameters_json');
  const bbox = extractBoundingBox(geoFilter, searchParams);
  const rawMaxResults =
    searchParams.maxResults !== undefined ? Number(searchParams.maxResults) : 50;
  const endpointUrl =
    typeof searchParams.endpointUrl === 'string' && searchParams.endpointUrl.trim()
      ? searchParams.endpointUrl.trim()
      : undefined;

  // Validate query parameters before checking dry-run so invalid pilot bboxes fail fast.
  const validatedQuery = adapter.validateQuery({
    country: job.country,
    state: job.state,
    lga: job.lga,
    category: job.category,
    bbox,
    maxResults: rawMaxResults,
    endpointUrl,
  });

  if (ctx.config.dryRun && searchParams.executeSourceInDryRun !== true) {
    return {
      counters: {
        discoveredCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        duplicateCount: 0,
        errorCount: 0,
      },
      note: `Dry-run validated query for source "${adapter.id}" (no external HTTP requests executed).`,
    };
  }

  const circuit = await isSourceCircuitOpen(ctx.env.DB, job.sourceId, ctx.now);
  if (circuit.open) {
    const retryAfterSeconds = Math.max(
      60,
      Math.ceil(((circuit.openUntil ?? ctx.now + 300_000) - ctx.now) / 1000),
    );
    throw new DiscoveryJobError(
      `Source "${job.sourceId}" circuit breaker is open until ${new Date(circuit.openUntil ?? ctx.now).toISOString()}.`,
      {
        kind: 'transient',
        code: 'SOURCE_CIRCUIT_OPEN',
        retryAfterSeconds,
      },
    );
  }

  try {
    const batchResult = await adapter.discover(validatedQuery, ctx.env, {
      fetchImpl: ctx.fetchImpl,
      now: ctx.now,
      skipCache: ctx.skipCache,
    });

    const ingestSummary = await ingestDiscoveredCandidates(ctx.env.DB, {
      attribution: adapter.attribution,
      candidates: batchResult.candidates,
      retrievedAt: batchResult.retrievedAt,
      sourceDataTimestamp: batchResult.sourceDataTimestamp,
    });

    await recordSourceCircuitSuccess(ctx.env.DB, job.sourceId, batchResult.retrievedAt);

    if (job.state) {
      await recordCoverageCellScan(ctx.env.DB, {
        sourceId: job.sourceId,
        state: job.state,
        lga: job.lga ?? 'All',
        category: job.category ?? 'All',
        discoveredDelta: ingestSummary.acceptedCount,
        now: batchResult.retrievedAt,
      }).catch(() => {});
    }

    return {
      counters: {
        discoveredCount: batchResult.totalRawElements,
        acceptedCount: ingestSummary.acceptedCount,
        rejectedCount: batchResult.rejectedCount,
        duplicateCount: ingestSummary.duplicateCount,
        errorCount: 0,
      },
      partial: batchResult.truncated,
      note:
        `Source "${adapter.id}" processed ${batchResult.totalRawElements} elements ` +
        `(accepted=${ingestSummary.acceptedCount}, duplicates=${ingestSummary.duplicateCount}, ` +
        `updated=${ingestSummary.updatedCount}, rejected=${batchResult.rejectedCount}, ` +
        `evidence=${ingestSummary.evidenceInsertedCount}, cached=${batchResult.cached}).`,
    };
  } catch (err) {
    await recordSourceCircuitFailure(ctx.env.DB, job.sourceId, err, ctx.now).catch(() => {});
    throw err;
  }
};

function logStructured(event: string, payload: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      scope: 'discovery.queue',
      event,
      timestamp: new Date().toISOString(),
      ...payload,
    }),
  );
}

async function processSingleMessage(
  message: DiscoveryQueueMessageItem,
  env: Bindings,
  config: DiscoveryRuntimeConfig,
  handler: DiscoveryJobHandler,
  now: number,
  runtimeOpts: { fetchImpl?: typeof fetch; skipCache?: boolean } = {},
): Promise<DiscoveryMessageResult> {
  // 1. Validate message schema & size before touching D1.
  let parsed;
  try {
    parsed = validateDiscoveryQueueMessage(message.body);
  } catch (err) {
    const classified = classifyDiscoveryError(err);
    logStructured('message.invalid', {
      messageId: message.id,
      attempts: message.attempts,
      code: classified.code,
      error: classified.safeMessage,
    });
    // Leave unacknowledged so Cloudflare Queues routes the poison message to the DLQ
    // after max_retries without executing any D1 or connector work.
    return {
      messageId: message.id,
      jobId: null,
      correlationId: null,
      outcome: 'dead_lettered',
      errorCode: classified.code,
    };
  }

  // 2. Respect global discovery kill-switch and admin D1 pause controls.
  const botSettings = await getDiscoveryBotSettings(env.DB);
  if (!config.enabled || botSettings.globalPaused || botSettings.discoveryPaused) {
    const delaySeconds = computeRetryDelaySeconds(message.attempts, {
      baseSeconds: 300,
      maxSeconds: 900,
    });
    message.retry({ delaySeconds });
    logStructured('message.paused', {
      messageId: message.id,
      jobId: parsed.jobId,
      correlationId: parsed.correlationId,
      retryDelaySeconds: delaySeconds,
    });
    return {
      messageId: message.id,
      jobId: parsed.jobId,
      correlationId: parsed.correlationId,
      outcome: 'skipped_disabled',
      retryDelaySeconds: delaySeconds,
    };
  }

  // 3. Atomically claim the persistent D1 job (prevents duplicate concurrent execution).
  const claim = await claimDiscoveryJob(env.DB, parsed.jobId, {
    maxAttempts: config.maxAttempts,
    staleTimeoutMs: config.staleJobTimeoutMs,
    now,
  });

  if (!claim.claimed || !claim.job) {
    if (claim.reason === 'already_completed') {
      message.ack();
      logStructured('job.skipped_completed', {
        messageId: message.id,
        jobId: parsed.jobId,
        correlationId: parsed.correlationId,
      });
      return {
        messageId: message.id,
        jobId: parsed.jobId,
        correlationId: parsed.correlationId,
        outcome: 'skipped_completed',
      };
    }

    if (claim.reason === 'cancelled') {
      message.ack();
      logStructured('job.skipped_cancelled', {
        messageId: message.id,
        jobId: parsed.jobId,
        correlationId: parsed.correlationId,
      });
      return {
        messageId: message.id,
        jobId: parsed.jobId,
        correlationId: parsed.correlationId,
        outcome: 'skipped_cancelled',
      };
    }

    if (claim.reason === 'already_running') {
      // Another isolate already holds the D1 lock for this job — acknowledge duplicate delivery.
      message.ack();
      logStructured('job.skipped_duplicate', {
        messageId: message.id,
        jobId: parsed.jobId,
        correlationId: parsed.correlationId,
      });
      return {
        messageId: message.id,
        jobId: parsed.jobId,
        correlationId: parsed.correlationId,
        outcome: 'skipped_duplicate',
      };
    }

    if (claim.reason === 'not_found') {
      logStructured('job.not_found', {
        messageId: message.id,
        jobId: parsed.jobId,
        correlationId: parsed.correlationId,
      });
      // Unacknowledged so invalid/dangling job reference surfaces in the DLQ.
      return {
        messageId: message.id,
        jobId: parsed.jobId,
        correlationId: parsed.correlationId,
        outcome: 'dead_lettered',
        errorCode: 'JOB_NOT_FOUND',
      };
    }

    // max_attempts_exceeded or terminal_failed: ensure D1 is marked failed and let Cloudflare DLQ it.
    if (claim.reason === 'max_attempts_exceeded') {
      await failDiscoveryJob(env.DB, parsed.jobId, 'Job exceeded maximum retry attempts.', {
        retryable: false,
        maxAttempts: config.maxAttempts,
        now,
      });
    }
    logStructured('job.dead_lettered', {
      messageId: message.id,
      jobId: parsed.jobId,
      correlationId: parsed.correlationId,
      reason: claim.reason,
    });
    return {
      messageId: message.id,
      jobId: parsed.jobId,
      correlationId: parsed.correlationId,
      outcome: 'dead_lettered',
      errorCode: claim.reason.toUpperCase(),
    };
  }

  const job = claim.job;

  // 4. Verify message jobType matches D1 and the backing source is still approved & enabled.
  try {
    if (job.jobType !== parsed.jobType) {
      throw new DiscoveryJobError(
        `Queue message jobType "${parsed.jobType}" does not match D1 jobType "${job.jobType}".`,
        {
          kind: 'permanent',
          code: 'JOB_TYPE_MISMATCH',
        },
      );
    }

    const sourceRow = await env.DB.prepare(
      'SELECT id, name, source_type, permission_status, enabled FROM discovery_sources WHERE id = ?',
    )
      .bind(job.sourceId)
      .first<{
        id: string;
        name: string;
        source_type: string;
        permission_status: string;
        enabled: number;
      }>();

    if (!sourceRow) {
      throw new DiscoveryJobError(`Discovery source "${job.sourceId}" no longer exists.`, {
        kind: 'permanent',
        code: 'SOURCE_NOT_FOUND',
      });
    }

    if (
      !isDiscoverySourceUsable({
        permissionStatus: sourceRow.permission_status,
        enabled: sourceRow.enabled,
      })
    ) {
      throw new DiscoveryJobError(
        `Discovery source "${job.sourceId}" is not approved and enabled (status=${sourceRow.permission_status}, enabled=${sourceRow.enabled}).`,
        {
          kind: 'permanent',
          code: 'SOURCE_NOT_USABLE',
        },
      );
    }

    // 5. Dispatch to the bounded job handler.
    const execResult = await handler(job, {
      env,
      config,
      correlationId: parsed.correlationId,
      queueAttempt: message.attempts,
      now,
      fetchImpl: runtimeOpts.fetchImpl,
      skipCache: runtimeOpts.skipCache,
      source: {
        id: sourceRow.id,
        name: sourceRow.name,
        sourceType: sourceRow.source_type,
        permissionStatus: sourceRow.permission_status,
        enabled: Boolean(sourceRow.enabled),
      },
    });

    // 6. Persist completion and acknowledge message.
    const completed = await completeDiscoveryJob(env.DB, job.id, execResult.counters, {
      partial: execResult.partial,
      note: execResult.note,
      now,
    });
    message.ack();

    const outcome: DiscoveryMessageOutcome =
      completed.status === 'partially_completed' ? 'partially_completed' : 'completed';

    logStructured('job.completed', {
      messageId: message.id,
      jobId: job.id,
      sourceId: job.sourceId,
      jobType: job.jobType,
      correlationId: parsed.correlationId,
      attempt: job.attempts,
      recoveredFromStale: claim.recoveredFromStale,
      outcome,
      discoveredCount: completed.discoveredCount,
      acceptedCount: completed.acceptedCount,
      duplicateCount: completed.duplicateCount,
      errorCount: completed.errorCount,
    });

    return {
      messageId: message.id,
      jobId: job.id,
      correlationId: parsed.correlationId,
      outcome,
    };
  } catch (err) {
    const classified = classifyDiscoveryError(err);
    const failureState = await failDiscoveryJob(env.DB, job.id, classified.safeMessage, {
      retryable: classified.retryable,
      maxAttempts: config.maxAttempts,
      now,
    });

    const canQueueRetry =
      !failureState.terminal &&
      classified.retryable &&
      message.attempts < config.maxAttempts;

    if (canQueueRetry) {
      const useJitter =
        classified.kind === 'rate_limited' || classified.code.startsWith('OSM_');
      const delaySeconds = computeRetryDelaySeconds(job.attempts, {
        retryAfterSeconds: classified.retryAfterSeconds,
        jitterRatio: useJitter ? 0.15 : 0,
      });
      message.retry({ delaySeconds });
      logStructured('job.retry_scheduled', {
        messageId: message.id,
        jobId: job.id,
        correlationId: parsed.correlationId,
        attempt: job.attempts,
        maxAttempts: config.maxAttempts,
        code: classified.code,
        retryDelaySeconds: delaySeconds,
        error: classified.safeMessage,
      });
      return {
        messageId: message.id,
        jobId: job.id,
        correlationId: parsed.correlationId,
        outcome: 'retried',
        errorCode: classified.code,
        retryDelaySeconds: delaySeconds,
      };
    }

    // Permanent failure or exhausted retries: D1 is already marked `failed` (never re-executed).
    // Leaving the message unacknowledged lets Cloudflare Queues route it to the dead-letter queue.
    logStructured('job.failed_terminal', {
      messageId: message.id,
      jobId: job.id,
      correlationId: parsed.correlationId,
      attempt: job.attempts,
      maxAttempts: config.maxAttempts,
      kind: classified.kind,
      code: classified.code,
      error: classified.safeMessage,
    });
    return {
      messageId: message.id,
      jobId: job.id,
      correlationId: parsed.correlationId,
      outcome: 'dead_lettered',
      errorCode: classified.code,
    };
  }
}

/**
 * Cloudflare Queues batch consumer for `naijapages-discovery` / `naijapages-discovery-dev`.
 * Isolates every message in its own error boundary so one failing message never loses
 * or aborts unrelated messages in the batch.
 */
export async function handleDiscoveryQueueBatch(
  batch: DiscoveryQueueBatch,
  env: Bindings,
  _ctx?: ExecutionContext,
  options: {
    handler?: DiscoveryJobHandler;
    now?: number;
    fetchImpl?: typeof fetch;
    skipCache?: boolean;
  } = {},
): Promise<DiscoveryBatchResult> {
  const config = parseDiscoveryConfig(env);
  const handler = options.handler ?? defaultDiscoveryJobHandler;
  const now = options.now ?? Date.now();
  const results: DiscoveryMessageResult[] = [];

  for (const message of batch.messages) {
    try {
      const res = await processSingleMessage(message, env, config, handler, now, {
        fetchImpl: options.fetchImpl,
        skipCache: options.skipCache,
      });
      results.push(res);
    } catch (unexpectedErr) {
      const classified = classifyDiscoveryError(unexpectedErr);
      logStructured('message.unexpected_error', {
        messageId: message.id,
        code: classified.code,
        error: classified.safeMessage,
      });
      if (classified.retryable && message.attempts < config.maxAttempts) {
        const delaySeconds = computeRetryDelaySeconds(message.attempts);
        message.retry({ delaySeconds });
        results.push({
          messageId: message.id,
          jobId: null,
          correlationId: null,
          outcome: 'retried',
          errorCode: classified.code,
          retryDelaySeconds: delaySeconds,
        });
      } else {
        results.push({
          messageId: message.id,
          jobId: null,
          correlationId: null,
          outcome: 'dead_lettered',
          errorCode: classified.code,
        });
      }
    }
  }

  return {
    queue: batch.queue,
    total: batch.messages.length,
    results,
  };
}
