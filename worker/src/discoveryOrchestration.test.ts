import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import worker from './index';
import {
  buildDiscoveryQueueMessage,
  cancelDiscoveryJob,
  claimDiscoveryJob,
  classifyDiscoveryError,
  completeDiscoveryJob,
  computeRetryDelaySeconds,
  createDiscoveryJob,
  DiscoveryJobError,
  enqueueDiscoveryJob,
  getDiscoveryJob,
  handleDiscoveryQueueBatch,
  handleDiscoveryScheduled,
  parseDiscoveryConfig,
  recoverStaleRunningJobs,
  retryDiscoveryJob,
  sanitizeDiscoveryErrorMessage,
  validateDiscoveryQueueMessage,
} from './services/discovery';
import type {
  Bindings,
  DiscoveryQueueBatch,
  DiscoveryQueueBinding,
  DiscoveryQueueMessage,
  DiscoveryQueueMessageItem,
} from './types';

const MIGRATION_SQLS = [
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0001_initial_schema.sql'), 'utf8'),
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0002_phase4_relational_data.sql'), 'utf8'),
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0003_phase5_r2_media.sql'), 'utf8'),
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0004_business_discovery.sql'), 'utf8'),
];

interface RecordedQueueSend {
  body: DiscoveryQueueMessage;
  delaySeconds?: number;
}

function createMockQueue(): {
  queue: DiscoveryQueueBinding;
  sent: RecordedQueueSend[];
} {
  const sent: RecordedQueueSend[] = [];
  const queue = {
    async send(body: DiscoveryQueueMessage, options?: { delaySeconds?: number }) {
      sent.push({ body, delaySeconds: options?.delaySeconds });
    },
    async sendBatch(messages: Iterable<{ body: DiscoveryQueueMessage; delaySeconds?: number }>) {
      for (const m of messages) {
        sent.push({ body: m.body, delaySeconds: m.delaySeconds });
      }
    },
  } as unknown as DiscoveryQueueBinding;
  return { queue, sent };
}

interface MockQueueMessageHandle {
  message: DiscoveryQueueMessageItem;
  acked: boolean;
  retried: boolean;
  retryDelaySeconds?: number;
}

function createMockMessage(
  body: unknown,
  opts: { id?: string; attempts?: number; timestamp?: Date } = {},
): MockQueueMessageHandle {
  const handle: MockQueueMessageHandle = {
    acked: false,
    retried: false,
    retryDelaySeconds: undefined,
    message: null as unknown as DiscoveryQueueMessageItem,
  };
  handle.message = {
    id: opts.id ?? `msg_${crypto.randomUUID()}`,
    timestamp: opts.timestamp ?? new Date(),
    body: body as DiscoveryQueueMessage,
    attempts: opts.attempts ?? 1,
    ack() {
      handle.acked = true;
    },
    retry(retryOpts?: { delaySeconds?: number }) {
      handle.retried = true;
      handle.retryDelaySeconds = retryOpts?.delaySeconds;
    },
  };
  return handle;
}

function createMockBatch(
  handles: MockQueueMessageHandle[],
  queueName = 'naijapages-discovery-dev',
): DiscoveryQueueBatch {
  return {
    queue: queueName,
    messages: handles.map((h) => h.message),
    ackAll() {
      for (const h of handles) h.acked = true;
    },
    retryAll(retryOpts?: { delaySeconds?: number }) {
      for (const h of handles) {
        h.retried = true;
        h.retryDelaySeconds = retryOpts?.delaySeconds;
      }
    },
  };
}

async function setupOrchestrationEnv(overrides: Partial<Bindings> = {}) {
  const proxy = await getPlatformProxy<Bindings>({ environment: 'development', persist: false });
  for (const sqlText of MIGRATION_SQLS) {
    const statements = sqlText
      .split(';')
      .map((s) =>
        s
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('--'))
          .join('\n')
          .trim(),
      )
      .filter((s) => s && !/^PRAGMA/i.test(s));

    for (const stmt of statements) {
      await proxy.env.DB.prepare(stmt).run();
    }
  }

  const mockQueue = createMockQueue();
  const env: Bindings = {
    ...proxy.env,
    DISCOVERY_QUEUE: mockQueue.queue,
    APP_ENV: 'development',
    APP_NAME: 'NaijaPages',
    APP_URL: 'http://localhost:8787',
    CORS_ORIGINS: 'http://localhost:3000,http://localhost:8787',
    REQUIRE_VERIFIED_EMAIL: 'true',
    DISCOVERY_ENABLED: 'false',
    DISCOVERY_SCHEDULER_ENABLED: 'false',
    DISCOVERY_DRY_RUN: 'true',
    DISCOVERY_MAX_JOBS_PER_RUN: '5',
    DISCOVERY_MAX_ATTEMPTS: '3',
    DISCOVERY_STALE_JOB_TIMEOUT_MS: '60000',
    DISCOVERY_MAX_QUEUED_BACKLOG: '100',
    ...overrides,
  };

  return {
    env,
    sent: mockQueue.sent,
    dispose: () => proxy.dispose(),
  };
}

async function seedSource(
  db: D1Database,
  opts: {
    id: string;
    name?: string;
    permissionStatus?: 'pending_review' | 'approved' | 'restricted' | 'rejected' | 'revoked';
    enabled?: boolean;
    lastSuccessfulSync?: number | null;
    now?: number;
  },
) {
  const now = opts.now ?? 1760000000000;
  await db
    .prepare(
      `INSERT INTO discovery_sources (
        id, name, source_type, base_url, licence_name, permission_status, enabled,
        rate_limit_per_minute, last_successful_sync, created_at, updated_at
      ) VALUES (?, ?, 'open_data', 'https://fixture.example.org', 'ODbL-1.0', ?, ?, 20, ?, ?, ?)`,
    )
    .bind(
      opts.id,
      opts.name ?? `Source ${opts.id}`,
      opts.permissionStatus ?? 'approved',
      opts.enabled === false ? 0 : 1,
      opts.lastSuccessfulSync ?? null,
      now,
      now,
    )
    .run();
}

// ---------------------------------------------------------------------------
// 1. Pure Queue Message Validation, Config Defaults & Error Classification
// ---------------------------------------------------------------------------

test('queue message validation enforces schema version, fields, and compact payload size', () => {
  const valid = buildDiscoveryQueueMessage({
    jobId: 'djob_123',
    jobType: 'state_sweep',
    enqueuedAt: 1760000000000,
    correlationId: 'corr_123',
  });
  assert.deepEqual(validateDiscoveryQueueMessage(valid), valid);

  // Wrong schema version
  assert.throws(
    () => validateDiscoveryQueueMessage({ ...valid, schemaVersion: 2 }),
    /Unsupported discovery queue message schemaVersion/i,
  );

  // Invalid jobType
  assert.throws(
    () => validateDiscoveryQueueMessage({ ...valid, jobType: 'scrape_all' }),
    /Unsupported discovery jobType/i,
  );

  // Missing jobId
  assert.throws(
    () => validateDiscoveryQueueMessage({ ...valid, jobId: '   ' }),
    /jobId is required/i,
  );

  // Oversized message carrying business records rejected
  assert.throws(
    () =>
      validateDiscoveryQueueMessage({
        ...valid,
        extraBusinessPayload: 'x'.repeat(2500),
      }),
    /exceeds maximum size/i,
  );

  // Feature flag safe defaults
  const defaults = parseDiscoveryConfig({});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.schedulerEnabled, false);
  assert.equal(defaults.dryRun, true);
  assert.equal(defaults.maxJobsPerRun, 5);
  assert.equal(defaults.maxAttempts, 3);

  // Scheduler cannot be enabled when master DISCOVERY_ENABLED is false
  const schedulerBlocked = parseDiscoveryConfig({
    DISCOVERY_ENABLED: 'false',
    DISCOVERY_SCHEDULER_ENABLED: 'true',
  });
  assert.equal(schedulerBlocked.enabled, false);
  assert.equal(schedulerBlocked.schedulerEnabled, false);

  // Error classification & secret redaction
  const redacted = sanitizeDiscoveryErrorMessage(
    new Error('Auth failed Bearer eyJhbGciOiJIUzI1NiJ9 token=secret123 cfat_abc123XYZ'),
  );
  assert.ok(!redacted.includes('eyJhbGciOiJIUzI1NiJ9'));
  assert.ok(!redacted.includes('secret123'));
  assert.ok(!redacted.includes('cfat_abc123XYZ'));

  assert.equal(classifyDiscoveryError(new SyntaxError('bad json')).retryable, false);
  assert.equal(classifyDiscoveryError(new Error('HTTP 429 too many requests')).kind, 'rate_limited');
  assert.equal(classifyDiscoveryError(new Error('network timeout')).retryable, true);
  assert.equal(computeRetryDelaySeconds(1, { baseSeconds: 30 }), 30);
  assert.equal(computeRetryDelaySeconds(2, { baseSeconds: 30 }), 60);
  assert.equal(computeRetryDelaySeconds(3, { baseSeconds: 30 }), 120);
});

// ---------------------------------------------------------------------------
// 2. Job Orchestration, Concurrent Locking, Retries, DLQ & Batch Isolation
// ---------------------------------------------------------------------------

test('discovery queue handles valid dispatch, batch isolation, duplicate delivery, completed/cancelled jobs, retries, and DLQ', async () => {
  const ctx = await setupOrchestrationEnv({
    DISCOVERY_ENABLED: 'true',
    DISCOVERY_DRY_RUN: 'true',
    DISCOVERY_MAX_ATTEMPTS: '3',
  });
  const now = 1760000000000;

  try {
    await seedSource(ctx.env.DB, { id: 'src_approved', permissionStatus: 'approved', enabled: true, now });
    await seedSource(ctx.env.DB, {
      id: 'src_pending',
      permissionStatus: 'pending_review',
      enabled: false,
      now,
    });

    // A. Valid job dispatch + batch isolation (invalid message in same batch does NOT drop valid job)
    const { job: validJob, created } = await createDiscoveryJob(ctx.env.DB, {
      id: 'job_valid_1',
      sourceId: 'src_approved',
      jobType: 'state_sweep',
      state: 'Lagos',
      idempotencyKey: 'valid-key-1',
      requireApprovedSource: true,
      now,
    });
    assert.equal(created, true);

    // Idempotent duplicate creation returns existing job with created: false
    const dupCreate = await createDiscoveryJob(ctx.env.DB, {
      sourceId: 'src_approved',
      jobType: 'state_sweep',
      state: 'Lagos',
      idempotencyKey: 'valid-key-1',
      now: now + 500,
    });
    assert.equal(dupCreate.created, false);
    assert.equal(dupCreate.job.id, validJob.id);

    const queuedMsg = await enqueueDiscoveryJob(ctx.env.DB, ctx.env.DISCOVERY_QUEUE!, validJob.id, {
      correlationId: 'corr_valid_1',
      now,
    });
    assert.equal(ctx.sent.length, 1);

    const invalidHandle = createMockMessage({ schemaVersion: 99, jobId: 'bad' }, { id: 'msg_bad' });
    const validHandle = createMockMessage(queuedMsg, { id: 'msg_valid_1' });
    const missingJobHandle = createMockMessage(
      buildDiscoveryQueueMessage({
        jobId: 'job_does_not_exist',
        jobType: 'state_sweep',
        enqueuedAt: now,
        correlationId: 'corr_missing',
      }),
      { id: 'msg_missing' },
    );

    const batchRes = await handleDiscoveryQueueBatch(
      createMockBatch([invalidHandle, validHandle, missingJobHandle]),
      ctx.env,
      undefined,
      { now: now + 1000 },
    );

    assert.equal(batchRes.results[0].outcome, 'dead_lettered');
    assert.equal(invalidHandle.acked, false);
    assert.equal(invalidHandle.retried, false);

    assert.equal(batchRes.results[1].outcome, 'completed');
    assert.equal(validHandle.acked, true);

    assert.equal(batchRes.results[2].outcome, 'dead_lettered');
    assert.equal(missingJobHandle.acked, false);

    const completedJob = await getDiscoveryJob(ctx.env.DB, validJob.id);
    assert.equal(completedJob?.status, 'completed');
    assert.equal(completedJob?.attempts, 1);

    // B. Already-completed job delivery is acknowledged cleanly and NOT re-executed
    let reExecCount = 0;
    const redeliveryHandle = createMockMessage(queuedMsg, { id: 'msg_redelivery', attempts: 2 });
    const redeliveryRes = await handleDiscoveryQueueBatch(
      createMockBatch([redeliveryHandle]),
      ctx.env,
      undefined,
      {
        now: now + 2000,
        handler: async () => {
          reExecCount += 1;
          return {};
        },
      },
    );
    assert.equal(redeliveryRes.results[0].outcome, 'skipped_completed');
    assert.equal(redeliveryHandle.acked, true);
    assert.equal(reExecCount, 0);

    // C. Cancelled job delivery is acknowledged cleanly and NOT executed
    const { job: cancelJob } = await createDiscoveryJob(ctx.env.DB, {
      id: 'job_cancelled_1',
      sourceId: 'src_approved',
      jobType: 'lga_sweep',
      now,
    });
    await cancelDiscoveryJob(ctx.env.DB, cancelJob.id, 'Operator paused sweep', now + 100);
    const cancelHandle = createMockMessage(
      buildDiscoveryQueueMessage({
        jobId: cancelJob.id,
        jobType: 'lga_sweep',
        enqueuedAt: now,
        correlationId: 'corr_cancel',
      }),
    );
    const cancelRes = await handleDiscoveryQueueBatch(
      createMockBatch([cancelHandle]),
      ctx.env,
      undefined,
      { now: now + 200 },
    );
    assert.equal(cancelRes.results[0].outcome, 'skipped_cancelled');
    assert.equal(cancelHandle.acked, true);

    // D. Concurrent job claim attempts + duplicate message delivery while already running
    const { job: raceJob } = await createDiscoveryJob(ctx.env.DB, {
      id: 'job_race_1',
      sourceId: 'src_approved',
      jobType: 'category_sweep',
      now,
    });
    const [claimA, claimB] = await Promise.all([
      claimDiscoveryJob(ctx.env.DB, raceJob.id, { maxAttempts: 3, now: now + 100 }),
      claimDiscoveryJob(ctx.env.DB, raceJob.id, { maxAttempts: 3, now: now + 100 }),
    ]);
    assert.equal([claimA.claimed, claimB.claimed].filter(Boolean).length, 1);
    const loser = claimA.claimed ? claimB : claimA;
    assert.equal(loser.reason, 'already_running');

    // Duplicate delivery while running is acked without invoking handler
    const dupRunHandle = createMockMessage(
      buildDiscoveryQueueMessage({
        jobId: raceJob.id,
        jobType: 'category_sweep',
        enqueuedAt: now,
        correlationId: 'corr_dup_run',
      }),
    );
    const dupRunRes = await handleDiscoveryQueueBatch(
      createMockBatch([dupRunHandle]),
      ctx.env,
      undefined,
      {
        now: now + 200,
        handler: async () => {
          throw new Error('Must not execute while already running');
        },
      },
    );
    assert.equal(dupRunRes.results[0].outcome, 'skipped_duplicate');
    assert.equal(dupRunHandle.acked, true);

    // E. Transient failure retries with controlled backoff, then succeeds on retry
    const { job: retryJob } = await createDiscoveryJob(ctx.env.DB, {
      id: 'job_retry_1',
      sourceId: 'src_approved',
      jobType: 'refresh',
      now,
    });
    const retryMsg = buildDiscoveryQueueMessage({
      jobId: retryJob.id,
      jobType: 'refresh',
      enqueuedAt: now,
      correlationId: 'corr_retry_1',
    });

    const attempt1Handle = createMockMessage(retryMsg, { id: 'msg_retry_a1', attempts: 1 });
    const attempt1Res = await handleDiscoveryQueueBatch(
      createMockBatch([attempt1Handle]),
      ctx.env,
      undefined,
      {
        now: now + 1000,
        handler: async () => {
          throw new DiscoveryJobError('Upstream gateway timeout', {
            kind: 'transient',
            code: 'UPSTREAM_TIMEOUT',
          });
        },
      },
    );
    assert.equal(attempt1Res.results[0].outcome, 'retried');
    assert.equal(attempt1Handle.retried, true);
    assert.equal(attempt1Handle.acked, false);
    assert.equal(attempt1Handle.retryDelaySeconds, 30);

    const afterFail1 = await getDiscoveryJob(ctx.env.DB, retryJob.id);
    assert.equal(afterFail1?.status, 'queued');
    assert.equal(afterFail1?.attempts, 1);
    assert.equal(afterFail1?.errorCount, 1);

    const attempt2Handle = createMockMessage(retryMsg, { id: 'msg_retry_a2', attempts: 2 });
    const attempt2Res = await handleDiscoveryQueueBatch(
      createMockBatch([attempt2Handle]),
      ctx.env,
      undefined,
      {
        now: now + 35_000,
        handler: async () => ({
          counters: { discoveredCount: 4, acceptedCount: 3, duplicateCount: 1 },
        }),
      },
    );
    assert.equal(attempt2Res.results[0].outcome, 'completed');
    assert.equal(attempt2Handle.acked, true);
    const afterSuccess2 = await getDiscoveryJob(ctx.env.DB, retryJob.id);
    assert.equal(afterSuccess2?.status, 'completed');
    assert.equal(afterSuccess2?.attempts, 2);
    assert.equal(afterSuccess2?.discoveredCount, 4);

    // F. Permanent failure (e.g. unapproved source) immediately fails in D1 and routes to DLQ (never retried)
    const { job: permJob } = await createDiscoveryJob(ctx.env.DB, {
      id: 'job_perm_1',
      sourceId: 'src_pending',
      jobType: 'targeted_lookup',
      now,
    });
    const permHandle = createMockMessage(
      buildDiscoveryQueueMessage({
        jobId: permJob.id,
        jobType: 'targeted_lookup',
        enqueuedAt: now,
        correlationId: 'corr_perm_1',
      }),
      { attempts: 1 },
    );
    const permRes = await handleDiscoveryQueueBatch(
      createMockBatch([permHandle]),
      ctx.env,
      undefined,
      { now: now + 1000 },
    );
    assert.equal(permRes.results[0].outcome, 'dead_lettered');
    assert.equal(permRes.results[0].errorCode, 'SOURCE_NOT_USABLE');
    assert.equal(permHandle.retried, false);
    assert.equal(permHandle.acked, false);

    const failedPerm = await getDiscoveryJob(ctx.env.DB, permJob.id);
    assert.equal(failedPerm?.status, 'failed');
    assert.ok(failedPerm?.completedAt !== null);

    // A failed job must NEVER be marked completed directly
    await assert.rejects(
      async () => completeDiscoveryJob(ctx.env.DB, permJob.id, { discoveredCount: 1 }),
      /Cannot complete discovery job/i,
    );

    // G. Exhausted transient retries reach dead-letter queue and can be safely replayed by operator
    const { job: exhaustJob } = await createDiscoveryJob(ctx.env.DB, {
      id: 'job_exhaust_1',
      sourceId: 'src_approved',
      jobType: 'reverification',
      now,
    });
    const exhaustMsg = buildDiscoveryQueueMessage({
      jobId: exhaustJob.id,
      jobType: 'reverification',
      enqueuedAt: now,
      correlationId: 'corr_exhaust',
    });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const h = createMockMessage(exhaustMsg, { attempts: attempt });
      const res = await handleDiscoveryQueueBatch(createMockBatch([h]), ctx.env, undefined, {
        now: now + attempt * 1000,
        handler: async () => {
          throw new Error('Temporary 503 service unavailable');
        },
      });
      if (attempt < 3) {
        assert.equal(res.results[0].outcome, 'retried');
        assert.equal(h.retried, true);
      } else {
        assert.equal(res.results[0].outcome, 'dead_lettered');
        assert.equal(h.retried, false);
        assert.equal(h.acked, false);
      }
    }

    const exhaustedRow = await getDiscoveryJob(ctx.env.DB, exhaustJob.id);
    assert.equal(exhaustedRow?.status, 'failed');
    assert.equal(exhaustedRow?.attempts, 3);

    // Replay without resetAttempts is blocked; replay with resetAttempts=true re-queues safely
    await assert.rejects(
      async () => retryDiscoveryJob(ctx.env.DB, ctx.env.DISCOVERY_QUEUE!, exhaustJob.id, { maxAttempts: 3 }),
      /exhausted maxAttempts/i,
    );
    const replayed = await retryDiscoveryJob(ctx.env.DB, ctx.env.DISCOVERY_QUEUE!, exhaustJob.id, {
      maxAttempts: 3,
      resetAttempts: true,
      now: now + 10_000,
    });
    assert.equal(replayed.job.status, 'queued');
    assert.equal(replayed.job.attempts, 0);
  } finally {
    await ctx.dispose();
  }
});

// ---------------------------------------------------------------------------
// 3. Cron Scheduler, Feature Flags, Limits & Interrupted Job Recovery
// ---------------------------------------------------------------------------

test('cron scheduler respects disabled defaults, enforces job/backlog limits, and recovers stale interrupted jobs', async () => {
  const ctx = await setupOrchestrationEnv({
    DISCOVERY_ENABLED: 'false',
    DISCOVERY_SCHEDULER_ENABLED: 'false',
    DISCOVERY_DRY_RUN: 'true',
    DISCOVERY_MAX_JOBS_PER_RUN: '2',
    DISCOVERY_MAX_ATTEMPTS: '3',
    DISCOVERY_STALE_JOB_TIMEOUT_MS: '60000',
    DISCOVERY_MAX_QUEUED_BACKLOG: '5',
  });
  const cronTime = Date.UTC(2026, 10, 20, 1, 0, 0); // 01:00 UTC = 02:00 Africa/Lagos

  try {
    await seedSource(ctx.env.DB, { id: 'src_a', permissionStatus: 'approved', enabled: true, now: cronTime });
    await seedSource(ctx.env.DB, { id: 'src_b', permissionStatus: 'approved', enabled: true, now: cronTime + 1 });
    await seedSource(ctx.env.DB, { id: 'src_c', permissionStatus: 'approved', enabled: true, now: cronTime + 2 });
    await seedSource(ctx.env.DB, {
      id: 'src_unapproved',
      permissionStatus: 'pending_review',
      enabled: false,
      now: cronTime + 3,
    });

    // 1. Disabled by default: creates 0 jobs and enqueues 0 messages
    const disabledSummary = await handleDiscoveryScheduled(
      { cron: '0 1 * * *', scheduledTime: cronTime },
      ctx.env,
    );
    assert.equal(disabledSummary.executed, false);
    assert.equal(disabledSummary.reason, 'discovery_disabled');
    assert.equal(ctx.sent.length, 0);

    // 2. Discovery enabled, scheduler still disabled -> skipped
    const schedDisabledSummary = await handleDiscoveryScheduled(
      { cron: '0 1 * * *', scheduledTime: cronTime },
      { ...ctx.env, DISCOVERY_ENABLED: 'true', DISCOVERY_SCHEDULER_ENABLED: 'false' },
    );
    assert.equal(schedDisabledSummary.executed, false);
    assert.equal(schedDisabledSummary.reason, 'scheduler_disabled');
    assert.equal(ctx.sent.length, 0);

    // 3. Both flags enabled: strictly enforces DISCOVERY_MAX_JOBS_PER_RUN = 2 and ignores unapproved sources
    const enabledEnv: Bindings = {
      ...ctx.env,
      DISCOVERY_ENABLED: 'true',
      DISCOVERY_SCHEDULER_ENABLED: 'true',
    };
    const enabledSummary = await handleDiscoveryScheduled(
      { cron: '0 1 * * *', scheduledTime: cronTime },
      enabledEnv,
    );
    assert.equal(enabledSummary.executed, true);
    assert.equal(enabledSummary.reason, 'scheduled');
    assert.equal(enabledSummary.utcDateKey, '2026-11-20');
    assert.equal(enabledSummary.createdJobIds.length, 2);
    assert.equal(enabledSummary.enqueuedJobIds.length, 2);
    assert.equal(ctx.sent.length, 2);

    // Re-running same UTC day is idempotent for src_a & src_b and schedules remaining approved src_c (not src_unapproved)
    const rerunSummary = await handleDiscoveryScheduled(
      { cron: '0 1 * * *', scheduledTime: cronTime + 1000 },
      enabledEnv,
    );
    assert.equal(rerunSummary.skippedExistingJobIds.length, 2);
    assert.equal(rerunSummary.createdJobIds.length, 0); // limited by LIMIT maxJobsPerRun=2 selecting src_a, src_b first

    // 4. Interrupted job recovery (stale `running` jobs past staleTimeoutMs)
    const { job: staleRecoverable } = await createDiscoveryJob(ctx.env.DB, {
      id: 'job_stale_recoverable',
      sourceId: 'src_c',
      jobType: 'state_sweep',
      now: cronTime,
    });
    await claimDiscoveryJob(ctx.env.DB, staleRecoverable.id, { maxAttempts: 3, now: cronTime });

    const { job: staleExhausted } = await createDiscoveryJob(ctx.env.DB, {
      id: 'job_stale_exhausted',
      sourceId: 'src_c',
      jobType: 'refresh',
      now: cronTime,
    });
    await ctx.env.DB.prepare(
      `UPDATE discovery_jobs SET status = 'running', attempts = 3, started_at = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(cronTime, cronTime, staleExhausted.id)
      .run();

    const recovery = await recoverStaleRunningJobs(ctx.env.DB, {
      staleTimeoutMs: 60_000,
      maxAttempts: 3,
      now: cronTime + 120_000,
    });
    assert.deepEqual(recovery.requeuedIds, ['job_stale_recoverable']);
    assert.deepEqual(recovery.failedIds, ['job_stale_exhausted']);

    const recoveredRow = await getDiscoveryJob(ctx.env.DB, staleRecoverable.id);
    const failedRow = await getDiscoveryJob(ctx.env.DB, staleExhausted.id);
    assert.equal(recoveredRow?.status, 'queued');
    assert.equal(failedRow?.status, 'failed');

    // 5. Backlog limit enforcement caps scheduler when active jobs >= maxQueuedBacklog
    const backlogCapped = await handleDiscoveryScheduled(
      { cron: '0 1 * * *', scheduledTime: cronTime + 86_400_000 },
      { ...enabledEnv, DISCOVERY_MAX_QUEUED_BACKLOG: '2' },
    );
    assert.equal(backlogCapped.reason, 'backlog_limit_reached');
    assert.equal(backlogCapped.createdJobIds.length, 0);
  } finally {
    await ctx.dispose();
  }
});

// ---------------------------------------------------------------------------
// 4. Worker Default Export Preserves Existing Hono API Routes + Handlers
// ---------------------------------------------------------------------------

test('Worker module export preserves existing Hono fetch routes alongside queue and scheduled handlers', async () => {
  const ctx = await setupOrchestrationEnv();
  try {
    const execCtx = {
      waitUntil(promise: Promise<unknown>) {
        void promise;
      },
      passThroughOnException() {},
    } as unknown as ExecutionContext;

    const healthRes = await worker.fetch!(
      new Request('http://localhost:8787/api/health'),
      ctx.env,
      execCtx,
    );
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { ok: boolean; data: { status: string } };
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.data.status, 'ok');

    const categoriesRes = await worker.fetch!(
      new Request('http://localhost:8787/api/v1/directory/categories'),
      ctx.env,
      execCtx,
    );
    assert.equal(categoriesRes.status, 200);

    const notFoundRes = await worker.fetch!(
      new Request('http://localhost:8787/api/v1/discovery/trigger', { method: 'POST' }),
      ctx.env,
      execCtx,
    );
    assert.equal(notFoundRes.status, 404);

    // Scheduled handler runs cleanly via waitUntil on default export
    const waitPromises: Promise<unknown>[] = [];
    await worker.scheduled!(
      { cron: '0 1 * * *', scheduledTime: Date.now(), noRetry() {} },
      ctx.env,
      {
        waitUntil(p: Promise<unknown>) {
          waitPromises.push(p);
        },
        passThroughOnException() {},
      } as unknown as ExecutionContext,
    );
    await Promise.all(waitPromises);
    assert.equal(waitPromises.length, 1);
  } finally {
    await ctx.dispose();
  }
});
