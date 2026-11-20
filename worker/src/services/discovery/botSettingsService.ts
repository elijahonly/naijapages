/**
 * D1-backed Bot Runtime Settings, Source Circuit Breaker, and Immutable Change History helpers.
 */
import { sanitizeDiscoveryErrorMessage } from './errors';

export interface DiscoveryBotSettings {
  globalPaused: boolean;
  discoveryPaused: boolean;
  monitoringPaused: boolean;
  dailyJobLimit: number;
  maxBatchSize: number;
  autoPublishMinConfidence: number;
  autoPublishMinSources: number;
  reviewMinConfidence: number;
  closureConfirmThreshold: number;
  monitoringDefaultDays: number;
  aiExtractionEnabled: boolean;
  aiDailyBudgetCalls: number;
  updatedBy: string | null;
  updatedAt: number;
}

export const DEFAULT_BOT_SETTINGS: DiscoveryBotSettings = {
  globalPaused: false,
  discoveryPaused: false,
  monitoringPaused: false,
  dailyJobLimit: 25,
  maxBatchSize: 50,
  autoPublishMinConfidence: 0.85,
  autoPublishMinSources: 2,
  reviewMinConfidence: 0.35,
  closureConfirmThreshold: 3,
  monitoringDefaultDays: 30,
  aiExtractionEnabled: false,
  aiDailyBudgetCalls: 50,
  updatedBy: null,
  updatedAt: 0,
};

interface BotSettingsRow {
  global_paused: number;
  discovery_paused: number;
  monitoring_paused: number;
  daily_job_limit: number;
  max_batch_size: number;
  auto_publish_min_confidence: number;
  auto_publish_min_sources: number;
  review_min_confidence: number;
  closure_confirm_threshold: number;
  monitoring_default_days: number;
  ai_extraction_enabled: number;
  ai_daily_budget_calls: number;
  updated_by: string | null;
  updated_at: number;
}

export async function getDiscoveryBotSettings(db: D1Database): Promise<DiscoveryBotSettings> {
  try {
    const row = await db
      .prepare(`SELECT * FROM discovery_bot_settings WHERE id = 'default'`)
      .first<BotSettingsRow>();
    if (!row) return { ...DEFAULT_BOT_SETTINGS };
    return {
      globalPaused: Boolean(row.global_paused),
      discoveryPaused: Boolean(row.discovery_paused),
      monitoringPaused: Boolean(row.monitoring_paused),
      dailyJobLimit: Number(row.daily_job_limit) || DEFAULT_BOT_SETTINGS.dailyJobLimit,
      maxBatchSize: Number(row.max_batch_size) || DEFAULT_BOT_SETTINGS.maxBatchSize,
      autoPublishMinConfidence: Number(row.auto_publish_min_confidence) || 0.85,
      autoPublishMinSources: Number(row.auto_publish_min_sources) || 2,
      reviewMinConfidence: Number(row.review_min_confidence) || 0.35,
      closureConfirmThreshold: Number(row.closure_confirm_threshold) || 3,
      monitoringDefaultDays: Number(row.monitoring_default_days) || 30,
      aiExtractionEnabled: Boolean(row.ai_extraction_enabled),
      aiDailyBudgetCalls: Number(row.ai_daily_budget_calls) || 50,
      updatedBy: row.updated_by,
      updatedAt: Number(row.updated_at) || 0,
    };
  } catch {
    // Graceful fallback when running against pre-0005 test fixtures
    return { ...DEFAULT_BOT_SETTINGS };
  }
}

export async function updateDiscoveryBotSettings(
  db: D1Database,
  patch: Partial<Omit<DiscoveryBotSettings, 'updatedBy' | 'updatedAt'>>,
  actorEmail: string,
  now: number = Date.now(),
): Promise<DiscoveryBotSettings> {
  const current = await getDiscoveryBotSettings(db);
  const next: DiscoveryBotSettings = {
    globalPaused: patch.globalPaused ?? current.globalPaused,
    discoveryPaused: patch.discoveryPaused ?? current.discoveryPaused,
    monitoringPaused: patch.monitoringPaused ?? current.monitoringPaused,
    dailyJobLimit: Math.min(500, Math.max(1, Math.trunc(patch.dailyJobLimit ?? current.dailyJobLimit))),
    maxBatchSize: Math.min(500, Math.max(1, Math.trunc(patch.maxBatchSize ?? current.maxBatchSize))),
    autoPublishMinConfidence: Math.min(
      1,
      Math.max(0.5, Number(patch.autoPublishMinConfidence ?? current.autoPublishMinConfidence)),
    ),
    autoPublishMinSources: Math.min(
      10,
      Math.max(1, Math.trunc(patch.autoPublishMinSources ?? current.autoPublishMinSources)),
    ),
    reviewMinConfidence: Math.min(
      1,
      Math.max(0, Number(patch.reviewMinConfidence ?? current.reviewMinConfidence)),
    ),
    closureConfirmThreshold: Math.min(
      10,
      Math.max(2, Math.trunc(patch.closureConfirmThreshold ?? current.closureConfirmThreshold)),
    ),
    monitoringDefaultDays: Math.min(
      365,
      Math.max(1, Math.trunc(patch.monitoringDefaultDays ?? current.monitoringDefaultDays)),
    ),
    aiExtractionEnabled: patch.aiExtractionEnabled ?? current.aiExtractionEnabled,
    aiDailyBudgetCalls: Math.min(
      5000,
      Math.max(0, Math.trunc(patch.aiDailyBudgetCalls ?? current.aiDailyBudgetCalls)),
    ),
    updatedBy: actorEmail,
    updatedAt: now,
  };

  await db
    .prepare(
      `INSERT INTO discovery_bot_settings (
        id, global_paused, discovery_paused, monitoring_paused,
        daily_job_limit, max_batch_size, auto_publish_min_confidence,
        auto_publish_min_sources, review_min_confidence, closure_confirm_threshold,
        monitoring_default_days, ai_extraction_enabled, ai_daily_budget_calls,
        updated_by, updated_at
      ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        global_paused = excluded.global_paused,
        discovery_paused = excluded.discovery_paused,
        monitoring_paused = excluded.monitoring_paused,
        daily_job_limit = excluded.daily_job_limit,
        max_batch_size = excluded.max_batch_size,
        auto_publish_min_confidence = excluded.auto_publish_min_confidence,
        auto_publish_min_sources = excluded.auto_publish_min_sources,
        review_min_confidence = excluded.review_min_confidence,
        closure_confirm_threshold = excluded.closure_confirm_threshold,
        monitoring_default_days = excluded.monitoring_default_days,
        ai_extraction_enabled = excluded.ai_extraction_enabled,
        ai_daily_budget_calls = excluded.ai_daily_budget_calls,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at`,
    )
    .bind(
      next.globalPaused ? 1 : 0,
      next.discoveryPaused ? 1 : 0,
      next.monitoringPaused ? 1 : 0,
      next.dailyJobLimit,
      next.maxBatchSize,
      next.autoPublishMinConfidence,
      next.autoPublishMinSources,
      next.reviewMinConfidence,
      next.closureConfirmThreshold,
      next.monitoringDefaultDays,
      next.aiExtractionEnabled ? 1 : 0,
      next.aiDailyBudgetCalls,
      next.updatedBy,
      next.updatedAt,
    )
    .run();

  return next;
}

const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

export async function isSourceCircuitOpen(
  db: D1Database,
  sourceId: string,
  now: number = Date.now(),
): Promise<{ open: boolean; openUntil: number | null; consecutiveFailures: number }> {
  try {
    const row = await db
      .prepare('SELECT consecutive_failures, circuit_open_until FROM discovery_sources WHERE id = ?')
      .bind(sourceId)
      .first<{ consecutive_failures: number | null; circuit_open_until: number | null }>();
    const openUntil = row?.circuit_open_until ?? null;
    const failures = Number(row?.consecutive_failures ?? 0);
    return {
      open: Boolean(openUntil && openUntil > now),
      openUntil,
      consecutiveFailures: failures,
    };
  } catch {
    return { open: false, openUntil: null, consecutiveFailures: 0 };
  }
}

export async function recordSourceCircuitSuccess(
  db: D1Database,
  sourceId: string,
  now: number = Date.now(),
): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE discovery_sources
         SET last_successful_sync = ?,
             last_error = NULL,
             health_status = 'healthy',
             consecutive_failures = 0,
             circuit_open_until = NULL,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(now, now, sourceId)
      .run();
  } catch {
    // Fallback for pre-0005 schemas
    await db
      .prepare(
        `UPDATE discovery_sources SET last_successful_sync = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
      )
      .bind(now, now, sourceId)
      .run();
  }
}

export async function recordSourceCircuitFailure(
  db: D1Database,
  sourceId: string,
  err: unknown,
  now: number = Date.now(),
): Promise<{ circuitOpened: boolean; consecutiveFailures: number }> {
  const safeError = sanitizeDiscoveryErrorMessage(err);
  try {
    const prev = await db
      .prepare('SELECT consecutive_failures FROM discovery_sources WHERE id = ?')
      .bind(sourceId)
      .first<{ consecutive_failures: number | null }>();
    const nextFailures = Number(prev?.consecutive_failures ?? 0) + 1;
    const circuitOpened = nextFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD;
    const circuitOpenUntil = circuitOpened ? now + CIRCUIT_BREAKER_COOLDOWN_MS : null;
    const healthStatus = circuitOpened ? 'circuit_open' : 'degraded';

    await db
      .prepare(
        `UPDATE discovery_sources
         SET last_failed_sync = ?,
             last_error = ?,
             health_status = ?,
             consecutive_failures = ?,
             circuit_open_until = COALESCE(?, circuit_open_until),
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(now, safeError, healthStatus, nextFailures, circuitOpenUntil, now, sourceId)
      .run();
    return { circuitOpened, consecutiveFailures: nextFailures };
  } catch {
    await db
      .prepare(
        `UPDATE discovery_sources SET last_failed_sync = ?, last_error = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(now, safeError, now, sourceId)
      .run();
    return { circuitOpened: false, consecutiveFailures: 1 };
  }
}

export interface ChangeHistoryInput {
  discoveredBusinessId?: string | null;
  businessId?: string | null;
  fieldChanged: string;
  oldValue?: string | null;
  newValue?: string | null;
  changeSource:
    | 'source_connector'
    | 'verification_engine'
    | 'deduplication_engine'
    | 'monitoring_bot'
    | 'admin_review'
    | 'owner_update';
  actorId?: string | null;
  actorEmail?: string | null;
  reason?: string | null;
  evidenceId?: string | null;
  appliedMode?: 'automatic' | 'admin_approved' | 'flagged_conflict';
  now?: number;
}

export async function recordBusinessChangeHistory(
  db: D1Database,
  input: ChangeHistoryInput,
): Promise<string> {
  const id = `bch_${crypto.randomUUID()}`;
  const now = input.now ?? Date.now();
  await db
    .prepare(
      `INSERT INTO business_change_history (
        id, discovered_business_id, business_id, field_changed,
        old_value, new_value, change_source, actor_id, actor_email,
        reason, evidence_id, applied_mode, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.discoveredBusinessId ?? null,
      input.businessId ?? null,
      input.fieldChanged,
      input.oldValue ?? null,
      input.newValue ?? null,
      input.changeSource,
      input.actorId ?? null,
      input.actorEmail ?? null,
      input.reason ?? null,
      input.evidenceId ?? null,
      input.appliedMode ?? 'automatic',
      now,
    )
    .run();
  return id;
}
