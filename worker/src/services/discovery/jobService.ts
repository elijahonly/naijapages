import {
  isDiscoverySourceUsable,
  validateDiscoveryJobInput,
  type DiscoveryJobStatus,
  type DiscoveryJobType,
} from '../../lib/discoveryValidation';
import type { DiscoveryQueueBinding, DiscoveryQueueMessage } from '../../types';
import { DISCOVERY_CONFIG_DEFAULTS } from './config';
import { DiscoveryJobError, sanitizeDiscoveryErrorMessage } from './errors';
import { buildDiscoveryQueueMessage } from './messages';

export interface DiscoveryJobCounters {
  discoveredCount: number;
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  errorCount: number;
}

export interface DiscoveryJobRecord {
  id: string;
  sourceId: string;
  jobType: DiscoveryJobType;
  country: string;
  state: string | null;
  lga: string | null;
  town: string | null;
  category: string | null;
  geographicFilterJson: string;
  searchParametersJson: string;
  status: DiscoveryJobStatus;
  priority: number;
  idempotencyKey: string | null;
  attempts: number;
  discoveredCount: number;
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  errorCount: number;
  errorMessage: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

interface RawDiscoveryJobRow {
  id: string;
  source_id: string;
  job_type: string;
  country: string;
  state: string | null;
  lga: string | null;
  town: string | null;
  category: string | null;
  geographic_filter_json: string;
  search_parameters_json: string;
  status: string;
  priority: number;
  idempotency_key: string | null;
  attempts: number;
  discovered_count: number;
  accepted_count: number;
  rejected_count: number;
  duplicate_count: number;
  error_count: number;
  error_message: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
}

function mapJobRow(row: RawDiscoveryJobRow): DiscoveryJobRecord {
  return {
    id: row.id,
    sourceId: row.source_id,
    jobType: row.job_type as DiscoveryJobType,
    country: row.country,
    state: row.state,
    lga: row.lga,
    town: row.town,
    category: row.category,
    geographicFilterJson: row.geographic_filter_json,
    searchParametersJson: row.search_parameters_json,
    status: row.status as DiscoveryJobStatus,
    priority: Number(row.priority) || 0,
    idempotencyKey: row.idempotency_key,
    attempts: Number(row.attempts) || 0,
    discoveredCount: Number(row.discovered_count) || 0,
    acceptedCount: Number(row.accepted_count) || 0,
    rejectedCount: Number(row.rejected_count) || 0,
    duplicateCount: Number(row.duplicate_count) || 0,
    errorCount: Number(row.error_count) || 0,
    errorMessage: row.error_message,
    createdAt: Number(row.created_at),
    startedAt: row.started_at === null ? null : Number(row.started_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at),
    updatedAt: Number(row.updated_at),
  };
}

export interface CreateDiscoveryJobInput {
  id?: string;
  sourceId: string;
  jobType: DiscoveryJobType;
  country?: string;
  state?: string | null;
  lga?: string | null;
  town?: string | null;
  category?: string | null;
  geographicFilter?: Record<string, unknown>;
  searchParameters?: Record<string, unknown>;
  priority?: number;
  idempotencyKey?: string | null;
  requireApprovedSource?: boolean;
  now?: number;
}

export interface CreateDiscoveryJobResult {
  job: DiscoveryJobRecord;
  created: boolean;
}

/**
 * Creates a persistent D1 discovery job with idempotency-key deduplication.
 * If a job with the same `idempotencyKey` already exists, returns it with `created: false`.
 */
export async function createDiscoveryJob(
  db: D1Database,
  input: CreateDiscoveryJobInput,
): Promise<CreateDiscoveryJobResult> {
  const now = input.now ?? Date.now();
  const id = input.id?.trim() || `djob_${crypto.randomUUID()}`;

  const validated = validateDiscoveryJobInput({
    id,
    sourceId: input.sourceId,
    jobType: input.jobType,
    country: input.country ?? 'Nigeria',
    state: input.state ?? null,
    lga: input.lga ?? null,
    town: input.town ?? null,
    category: input.category ?? null,
    geographicFilter: input.geographicFilter ?? {},
    searchParameters: input.searchParameters ?? {},
    status: 'queued',
    priority: input.priority ?? 100,
    idempotencyKey: input.idempotencyKey ?? null,
    attempts: 0,
  });

  // Verify source exists (and optionally that it is currently approved & enabled).
  const sourceRow = await db
    .prepare('SELECT id, permission_status, enabled FROM discovery_sources WHERE id = ?')
    .bind(validated.sourceId)
    .first<{ id: string; permission_status: string; enabled: number }>();

  if (!sourceRow) {
    throw new DiscoveryJobError(`Discovery source "${validated.sourceId}" was not found.`, {
      kind: 'permanent',
      code: 'SOURCE_NOT_FOUND',
    });
  }

  if (
    input.requireApprovedSource &&
    !isDiscoverySourceUsable({
      permissionStatus: sourceRow.permission_status,
      enabled: sourceRow.enabled,
    })
  ) {
    throw new DiscoveryJobError(
      `Discovery source "${validated.sourceId}" is not approved and enabled.`,
      {
        kind: 'permanent',
        code: 'SOURCE_NOT_USABLE',
      },
    );
  }

  if (validated.idempotencyKey) {
    const existing = await db
      .prepare('SELECT * FROM discovery_jobs WHERE idempotency_key = ?')
      .bind(validated.idempotencyKey)
      .first<RawDiscoveryJobRow>();
    if (existing) {
      return { job: mapJobRow(existing), created: false };
    }
  }

  const insertRes = await db
    .prepare(
      `INSERT OR IGNORE INTO discovery_jobs (
        id, source_id, job_type, country, state, lga, town, category,
        geographic_filter_json, search_parameters_json,
        status, priority, idempotency_key, attempts,
        discovered_count, accepted_count, rejected_count, duplicate_count, error_count,
        error_message, created_at, started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, 0, 0, 0, 0, 0, 0, NULL, ?, NULL, NULL, ?)`,
    )
    .bind(
      validated.id,
      validated.sourceId,
      validated.jobType,
      validated.country,
      validated.state,
      validated.lga,
      validated.town,
      validated.category,
      validated.geographicFilterJson,
      validated.searchParametersJson,
      validated.priority,
      validated.idempotencyKey,
      now,
      now,
    )
    .run();

  const changes = Number(insertRes.meta?.changes ?? 0);
  if (changes === 0 && validated.idempotencyKey) {
    const raced = await db
      .prepare('SELECT * FROM discovery_jobs WHERE idempotency_key = ?')
      .bind(validated.idempotencyKey)
      .first<RawDiscoveryJobRow>();
    if (raced) {
      return { job: mapJobRow(raced), created: false };
    }
  }

  const createdRow = await getDiscoveryJob(db, validated.id);
  if (!createdRow) {
    throw new DiscoveryJobError(`Failed to persist discovery job "${validated.id}".`, {
      kind: 'transient',
      code: 'JOB_INSERT_FAILED',
    });
  }

  return { job: createdRow, created: changes > 0 };
}

export async function getDiscoveryJob(
  db: D1Database,
  jobId: string,
): Promise<DiscoveryJobRecord | null> {
  const row = await db
    .prepare('SELECT * FROM discovery_jobs WHERE id = ?')
    .bind(jobId)
    .first<RawDiscoveryJobRow>();
  return row ? mapJobRow(row) : null;
}

export type ClaimDiscoveryJobReason =
  | 'claimed'
  | 'not_found'
  | 'already_completed'
  | 'cancelled'
  | 'already_running'
  | 'max_attempts_exceeded'
  | 'terminal_failed';

export interface ClaimDiscoveryJobResult {
  claimed: boolean;
  reason: ClaimDiscoveryJobReason;
  job: DiscoveryJobRecord | null;
  recoveredFromStale: boolean;
}

/**
 * Atomically claims a discovery job in D1 using a single conditional UPDATE.
 * Safe across multiple Worker isolates: only one concurrent caller can observe `changes === 1`.
 * Also supports safe recovery of interrupted `running` jobs older than `staleTimeoutMs`.
 */
export async function claimDiscoveryJob(
  db: D1Database,
  jobId: string,
  opts: { maxAttempts?: number; staleTimeoutMs?: number; now?: number } = {},
): Promise<ClaimDiscoveryJobResult> {
  const now = opts.now ?? Date.now();
  const maxAttempts = Math.max(1, Math.trunc(opts.maxAttempts ?? DISCOVERY_CONFIG_DEFAULTS.maxAttempts));
  const staleTimeoutMs = Math.max(
    1_000,
    Math.trunc(opts.staleTimeoutMs ?? DISCOVERY_CONFIG_DEFAULTS.staleJobTimeoutMs),
  );
  const staleCutoff = now - staleTimeoutMs;

  const preRow = await db
    .prepare('SELECT status, updated_at FROM discovery_jobs WHERE id = ?')
    .bind(jobId)
    .first<{ status: string; updated_at: number }>();
  const wasStaleRunning =
    preRow?.status === 'running' && Number(preRow.updated_at) <= staleCutoff;

  const updateRes = await db
    .prepare(
      `UPDATE discovery_jobs
       SET status = 'running',
           attempts = attempts + 1,
           started_at = COALESCE(started_at, ?),
           updated_at = ?,
           error_message = NULL
       WHERE id = ?
         AND attempts < ?
         AND (
           status = 'queued'
           OR (status = 'running' AND updated_at <= ?)
         )`,
    )
    .bind(now, now, jobId, maxAttempts, staleCutoff)
    .run();

  const current = await getDiscoveryJob(db, jobId);
  if (Number(updateRes.meta?.changes ?? 0) === 1 && current) {
    return {
      claimed: true,
      reason: 'claimed',
      job: current,
      recoveredFromStale: wasStaleRunning,
    };
  }

  if (!current) {
    return { claimed: false, reason: 'not_found', job: null, recoveredFromStale: false };
  }

  if (current.status === 'completed' || current.status === 'partially_completed') {
    return { claimed: false, reason: 'already_completed', job: current, recoveredFromStale: false };
  }
  if (current.status === 'cancelled') {
    return { claimed: false, reason: 'cancelled', job: current, recoveredFromStale: false };
  }
  if (current.status === 'failed') {
    return { claimed: false, reason: 'terminal_failed', job: current, recoveredFromStale: false };
  }
  if (current.attempts >= maxAttempts) {
    return {
      claimed: false,
      reason: 'max_attempts_exceeded',
      job: current,
      recoveredFromStale: false,
    };
  }
  return { claimed: false, reason: 'already_running', job: current, recoveredFromStale: false };
}

function sanitizeCounter(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/**
 * Transitions a `running` job to `completed` or `partially_completed`.
 * Never marks a `failed` or `cancelled` job as completed.
 */
export async function completeDiscoveryJob(
  db: D1Database,
  jobId: string,
  counters: Partial<DiscoveryJobCounters> = {},
  opts: { partial?: boolean; note?: string | null; now?: number } = {},
): Promise<DiscoveryJobRecord> {
  const now = opts.now ?? Date.now();
  const nextStatus: DiscoveryJobStatus = opts.partial ? 'partially_completed' : 'completed';
  const note = opts.note ? sanitizeDiscoveryErrorMessage(opts.note) : null;

  const res = await db
    .prepare(
      `UPDATE discovery_jobs
       SET status = ?,
           discovered_count = ?,
           accepted_count = ?,
           rejected_count = ?,
           duplicate_count = ?,
           error_count = ?,
           error_message = ?,
           completed_at = CASE WHEN started_at IS NOT NULL AND ? < started_at THEN started_at ELSE ? END,
           updated_at = ?
       WHERE id = ?
         AND status = 'running'`,
    )
    .bind(
      nextStatus,
      sanitizeCounter(counters.discoveredCount),
      sanitizeCounter(counters.acceptedCount),
      sanitizeCounter(counters.rejectedCount),
      sanitizeCounter(counters.duplicateCount),
      sanitizeCounter(counters.errorCount),
      note,
      now,
      now,
      now,
      jobId,
    )
    .run();

  if (Number(res.meta?.changes ?? 0) !== 1) {
    const existing = await getDiscoveryJob(db, jobId);
    throw new DiscoveryJobError(
      `Cannot complete discovery job "${jobId}" from status "${existing?.status ?? 'missing'}".`,
      {
        kind: 'permanent',
        code: 'INVALID_JOB_TRANSITION',
      },
    );
  }

  return (await getDiscoveryJob(db, jobId))!;
}

/**
 * Persists a job failure in D1.
 * - If `retryable` and `attempts < maxAttempts`, resets status to `queued` so the queue retry can reclaim it.
 * - Otherwise marks the job permanently `failed` with `completed_at` set.
 */
export async function failDiscoveryJob(
  db: D1Database,
  jobId: string,
  error: unknown,
  opts: {
    retryable?: boolean;
    maxAttempts?: number;
    counters?: Partial<DiscoveryJobCounters>;
    now?: number;
  } = {},
): Promise<{ job: DiscoveryJobRecord | null; terminal: boolean }> {
  const now = opts.now ?? Date.now();
  const maxAttempts = Math.max(1, Math.trunc(opts.maxAttempts ?? DISCOVERY_CONFIG_DEFAULTS.maxAttempts));
  const safeError = sanitizeDiscoveryErrorMessage(error);

  const existing = await getDiscoveryJob(db, jobId);
  if (!existing) {
    return { job: null, terminal: true };
  }
  if (
    existing.status === 'completed' ||
    existing.status === 'partially_completed' ||
    existing.status === 'cancelled'
  ) {
    return { job: existing, terminal: true };
  }

  const willRetry = Boolean(opts.retryable) && existing.attempts < maxAttempts;
  const nextStatus: DiscoveryJobStatus = willRetry ? 'queued' : 'failed';
  const nextCompletedAt = willRetry
    ? null
    : existing.startedAt !== null && now < existing.startedAt
      ? existing.startedAt
      : now;

  const discovered =
    opts.counters?.discoveredCount !== undefined
      ? sanitizeCounter(opts.counters.discoveredCount)
      : existing.discoveredCount;
  const accepted =
    opts.counters?.acceptedCount !== undefined
      ? sanitizeCounter(opts.counters.acceptedCount)
      : existing.acceptedCount;
  const rejected =
    opts.counters?.rejectedCount !== undefined
      ? sanitizeCounter(opts.counters.rejectedCount)
      : existing.rejectedCount;
  const duplicate =
    opts.counters?.duplicateCount !== undefined
      ? sanitizeCounter(opts.counters.duplicateCount)
      : existing.duplicateCount;
  const errorCount =
    opts.counters?.errorCount !== undefined
      ? Math.max(existing.errorCount + 1, sanitizeCounter(opts.counters.errorCount))
      : existing.errorCount + 1;

  await db
    .prepare(
      `UPDATE discovery_jobs
       SET status = ?,
           discovered_count = ?,
           accepted_count = ?,
           rejected_count = ?,
           duplicate_count = ?,
           error_count = ?,
           error_message = ?,
           completed_at = ?,
           updated_at = ?
       WHERE id = ?
         AND status IN ('queued', 'running', 'failed')`,
    )
    .bind(
      nextStatus,
      discovered,
      accepted,
      rejected,
      duplicate,
      errorCount,
      safeError,
      nextCompletedAt,
      now,
      jobId,
    )
    .run();

  return {
    job: await getDiscoveryJob(db, jobId),
    terminal: !willRetry,
  };
}

/**
 * Cancels a `queued` or `running` job. Completed jobs cannot be cancelled.
 */
export async function cancelDiscoveryJob(
  db: D1Database,
  jobId: string,
  reason?: string,
  now: number = Date.now(),
): Promise<DiscoveryJobRecord | null> {
  const safeReason = reason ? sanitizeDiscoveryErrorMessage(reason) : 'Cancelled by operator.';

  const res = await db
    .prepare(
      `UPDATE discovery_jobs
       SET status = 'cancelled',
           error_message = ?,
           completed_at = CASE WHEN started_at IS NOT NULL AND ? < started_at THEN started_at ELSE ? END,
           updated_at = ?
       WHERE id = ?
         AND status IN ('queued', 'running')`,
    )
    .bind(safeReason, now, now, now, jobId)
    .run();

  if (Number(res.meta?.changes ?? 0) === 0) {
    return getDiscoveryJob(db, jobId);
  }
  return getDiscoveryJob(db, jobId);
}

/**
 * Enqueues a compact pointer message onto Cloudflare Queues for a `queued` D1 job.
 */
export async function enqueueDiscoveryJob(
  db: D1Database,
  queue: DiscoveryQueueBinding,
  jobId: string,
  opts: { correlationId?: string; delaySeconds?: number; now?: number } = {},
): Promise<DiscoveryQueueMessage> {
  const job = await getDiscoveryJob(db, jobId);
  if (!job) {
    throw new DiscoveryJobError(`Cannot enqueue missing discovery job "${jobId}".`, {
      kind: 'permanent',
      code: 'JOB_NOT_FOUND',
    });
  }
  if (job.status !== 'queued') {
    throw new DiscoveryJobError(
      `Discovery job "${jobId}" must be in "queued" status to enqueue (current: "${job.status}").`,
      {
        kind: 'permanent',
        code: 'JOB_NOT_QUEUED',
      },
    );
  }

  const message = buildDiscoveryQueueMessage({
    jobId: job.id,
    jobType: job.jobType,
    enqueuedAt: opts.now ?? Date.now(),
    correlationId: opts.correlationId,
  });

  if (typeof opts.delaySeconds === 'number' && opts.delaySeconds > 0) {
    await queue.send(message, { delaySeconds: Math.trunc(opts.delaySeconds) });
  } else {
    await queue.send(message);
  }

  return message;
}

/**
 * Safely re-queues a failed, partially_completed, or stale running job and dispatches a fresh queue message.
 */
export async function retryDiscoveryJob(
  db: D1Database,
  queue: DiscoveryQueueBinding,
  jobId: string,
  opts: {
    maxAttempts?: number;
    staleTimeoutMs?: number;
    resetAttempts?: boolean;
    correlationId?: string;
    delaySeconds?: number;
    now?: number;
  } = {},
): Promise<{ job: DiscoveryJobRecord; message: DiscoveryQueueMessage }> {
  const now = opts.now ?? Date.now();
  const maxAttempts = Math.max(1, Math.trunc(opts.maxAttempts ?? DISCOVERY_CONFIG_DEFAULTS.maxAttempts));
  const staleTimeoutMs = Math.max(
    1_000,
    Math.trunc(opts.staleTimeoutMs ?? DISCOVERY_CONFIG_DEFAULTS.staleJobTimeoutMs),
  );
  const staleCutoff = now - staleTimeoutMs;

  const existing = await getDiscoveryJob(db, jobId);
  if (!existing) {
    throw new DiscoveryJobError(`Cannot retry missing discovery job "${jobId}".`, {
      kind: 'permanent',
      code: 'JOB_NOT_FOUND',
    });
  }
  if (existing.status === 'completed') {
    throw new DiscoveryJobError(`Discovery job "${jobId}" is already completed.`, {
      kind: 'permanent',
      code: 'JOB_ALREADY_COMPLETED',
    });
  }
  if (existing.status === 'cancelled') {
    throw new DiscoveryJobError(`Discovery job "${jobId}" was cancelled and cannot be retried.`, {
      kind: 'permanent',
      code: 'JOB_CANCELLED',
    });
  }
  if (existing.status === 'running' && existing.updatedAt > staleCutoff) {
    throw new DiscoveryJobError(`Discovery job "${jobId}" is currently running.`, {
      kind: 'transient',
      code: 'JOB_CURRENTLY_RUNNING',
    });
  }
  if (!opts.resetAttempts && existing.attempts >= maxAttempts) {
    throw new DiscoveryJobError(
      `Discovery job "${jobId}" has exhausted maxAttempts (${maxAttempts}). Pass resetAttempts=true for explicit operator replay.`,
      {
        kind: 'permanent',
        code: 'MAX_ATTEMPTS_EXCEEDED',
      },
    );
  }

  const nextAttempts = opts.resetAttempts ? 0 : existing.attempts;
  const res = await db
    .prepare(
      `UPDATE discovery_jobs
       SET status = 'queued',
           attempts = ?,
           completed_at = NULL,
           error_message = NULL,
           updated_at = ?
       WHERE id = ?
         AND (
           status IN ('failed', 'partially_completed', 'queued')
           OR (status = 'running' AND updated_at <= ?)
         )`,
    )
    .bind(nextAttempts, now, jobId, staleCutoff)
    .run();

  if (Number(res.meta?.changes ?? 0) !== 1) {
    throw new DiscoveryJobError(`Unable to transition discovery job "${jobId}" to queued for retry.`, {
      kind: 'transient',
      code: 'RETRY_TRANSITION_CONFLICT',
    });
  }

  const message = await enqueueDiscoveryJob(db, queue, jobId, {
    correlationId: opts.correlationId,
    delaySeconds: opts.delaySeconds,
    now,
  });

  const updated = (await getDiscoveryJob(db, jobId))!;
  return { job: updated, message };
}

export interface StaleRecoverySummary {
  requeuedIds: string[];
  failedIds: string[];
}

/**
 * Recovers interrupted jobs left in `running` beyond `staleTimeoutMs`.
 * - If `attempts < maxAttempts`, resets to `queued` for re-dispatch.
 * - If `attempts >= maxAttempts`, marks permanently `failed` so they stop blocking backlog limits.
 */
export async function recoverStaleRunningJobs(
  db: D1Database,
  opts: { staleTimeoutMs?: number; maxAttempts?: number; limit?: number; now?: number } = {},
): Promise<StaleRecoverySummary> {
  const now = opts.now ?? Date.now();
  const staleTimeoutMs = Math.max(
    1_000,
    Math.trunc(opts.staleTimeoutMs ?? DISCOVERY_CONFIG_DEFAULTS.staleJobTimeoutMs),
  );
  const maxAttempts = Math.max(1, Math.trunc(opts.maxAttempts ?? DISCOVERY_CONFIG_DEFAULTS.maxAttempts));
  const limit = Math.min(100, Math.max(1, Math.trunc(opts.limit ?? 25)));
  const staleCutoff = now - staleTimeoutMs;

  const staleRes = await db
    .prepare(
      `SELECT id, attempts, started_at FROM discovery_jobs
       WHERE status = 'running' AND updated_at <= ?
       ORDER BY updated_at ASC
       LIMIT ?`,
    )
    .bind(staleCutoff, limit)
    .all<{ id: string; attempts: number; started_at: number | null }>();

  const requeuedIds: string[] = [];
  const failedIds: string[] = [];

  for (const row of staleRes.results ?? []) {
    if (Number(row.attempts) < maxAttempts) {
      const r = await db
        .prepare(
          `UPDATE discovery_jobs
           SET status = 'queued',
               error_count = error_count + 1,
               error_message = 'Recovered after worker interruption timeout.',
               updated_at = ?
           WHERE id = ? AND status = 'running' AND updated_at <= ?`,
        )
        .bind(now, row.id, staleCutoff)
        .run();
      if (Number(r.meta?.changes ?? 0) === 1) {
        requeuedIds.push(row.id);
      }
    } else {
      const completedAt =
        row.started_at !== null && now < Number(row.started_at) ? Number(row.started_at) : now;
      const r = await db
        .prepare(
          `UPDATE discovery_jobs
           SET status = 'failed',
               error_count = error_count + 1,
               error_message = 'Job exceeded max attempts after worker interruption timeout.',
               completed_at = ?,
               updated_at = ?
           WHERE id = ? AND status = 'running' AND updated_at <= ?`,
        )
        .bind(completedAt, now, row.id, staleCutoff)
        .run();
      if (Number(r.meta?.changes ?? 0) === 1) {
        failedIds.push(row.id);
      }
    }
  }

  return { requeuedIds, failedIds };
}

export async function countActiveQueuedBacklog(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM discovery_jobs WHERE status IN ('queued', 'running')`)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}
