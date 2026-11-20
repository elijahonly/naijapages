/**
 * Progressive Continuous Monitoring Engine for NaijaPages businesses.
 *
 * Strict anti-false-closure guarantees:
 * - A single website outage, timeout, or missing directory entry NEVER marks a business closed.
 * - Uses a progressive state machine:
 *     healthy -> watch (1st signal) -> potentially_outdated -> under_investigation
 *     -> confirmed_closed + archived (only when corroborated closure signals >= threshold or admin confirms).
 * - Relocation signals update/flag location cleanly instead of treating the business as closed.
 * - Archived records are hidden from public search while permanently preserving audit & evidence history.
 */
import { extractStructuredFieldsFromText, validateSafeExternalFetchUrl } from './normalization';
import { recordBusinessChangeHistory } from './botSettingsService';

export type MonitoringHealthStatus =
  | 'healthy'
  | 'watch'
  | 'potentially_outdated'
  | 'under_investigation'
  | 'relocated'
  | 'confirmed_closed'
  | 'archived';

export interface MonitoringSignalInput {
  kind:
    | 'check_passed'
    | 'website_unreachable'
    | 'website_closure_notice'
    | 'website_relocation_notice'
    | 'source_removed'
    | 'phone_changed'
    | 'address_changed'
    | 'name_changed'
    | 'corroborated_closure';
  detail: string;
  observedValue?: string | null;
  sourceUrl?: string | null;
  now?: number;
}

export interface MonitoringStateSnapshot {
  healthStatus: MonitoringHealthStatus;
  checkIntervalDays: number;
  verificationAttempts: number;
  failedChecks: number;
  consecutiveFailures: number;
  closureSignalCount: number;
  closureSignals: Array<{ kind: string; detail: string; observedAt: number }>;
}

export interface MonitoringTransitionResult {
  nextHealthStatus: MonitoringHealthStatus;
  nextLifecycleStatus:
    | 'published'
    | 'potentially_outdated'
    | 'under_investigation'
    | 'confirmed_closed'
    | 'archived';
  nextCheckDelayDays: number;
  shouldCreateReviewTask: boolean;
  reviewReason: 'suspected_closure' | 'suspected_relocation' | 'conflicting_data' | null;
  suggestedAction: 'archive_closed' | 'update_location' | 'request_verification' | null;
  closureConfirmed: boolean;
  explanation: string;
}

/**
 * Pure progressive monitoring transition function (unit-tested independently of D1/HTTP).
 */
export function evaluateMonitoringTransition(
  current: MonitoringStateSnapshot,
  signal: MonitoringSignalInput,
  options: { closureConfirmThreshold?: number } = {},
): MonitoringTransitionResult {
  const threshold = Math.max(2, options.closureConfirmThreshold ?? 3);

  // 1. Healthy check resets transient failure streaks
  if (signal.kind === 'check_passed') {
    return {
      nextHealthStatus: 'healthy',
      nextLifecycleStatus: 'published',
      nextCheckDelayDays: current.checkIntervalDays,
      shouldCreateReviewTask: false,
      reviewReason: null,
      suggestedAction: null,
      closureConfirmed: false,
      explanation: 'Monitoring check succeeded; listing remains healthy and active.',
    };
  }

  // 2. Relocation signal — NEVER treat relocation as permanent closure!
  if (signal.kind === 'website_relocation_notice' || signal.kind === 'address_changed') {
    return {
      nextHealthStatus: 'relocated',
      nextLifecycleStatus: 'potentially_outdated',
      nextCheckDelayDays: 7,
      shouldCreateReviewTask: true,
      reviewReason: 'suspected_relocation',
      suggestedAction: 'update_location',
      closureConfirmed: false,
      explanation: 'Relocation signal detected; flagged for location update rather than closure.',
    };
  }

  // 3. Phone or Name change conflict — flag for review without archiving
  if (signal.kind === 'phone_changed' || signal.kind === 'name_changed') {
    return {
      nextHealthStatus: 'potentially_outdated',
      nextLifecycleStatus: 'potentially_outdated',
      nextCheckDelayDays: 7,
      shouldCreateReviewTask: true,
      reviewReason: 'conflicting_data',
      suggestedAction: 'request_verification',
      closureConfirmed: false,
      explanation: `${signal.kind} detected; escalated for review while keeping listing intact.`,
    };
  }

  // 4. Temporary website outage / single unreachable check
  if (signal.kind === 'website_unreachable' || signal.kind === 'source_removed') {
    const nextConsecutive = current.consecutiveFailures + 1;
    // First failure ONLY puts listing on watch and schedules a recheck (never closes!)
    if (nextConsecutive === 1) {
      return {
        nextHealthStatus: 'watch',
        nextLifecycleStatus: 'published',
        nextCheckDelayDays: 3,
        shouldCreateReviewTask: false,
        reviewReason: null,
        suggestedAction: null,
        closureConfirmed: false,
        explanation:
          'Single unreachable check recorded as watch signal; scheduled recheck in 3 days (never closed on one failure).',
      };
    }

    if (nextConsecutive < threshold) {
      return {
        nextHealthStatus: 'potentially_outdated',
        nextLifecycleStatus: 'potentially_outdated',
        nextCheckDelayDays: 5,
        shouldCreateReviewTask: true,
        reviewReason: 'suspected_closure',
        suggestedAction: 'request_verification',
        closureConfirmed: false,
        explanation: `Repeated unreachable signal (${nextConsecutive}/${threshold}); marked potentially outdated and escalated for review.`,
      };
    }

    // Even multiple unreachable pings alone without explicit closure notice escalate to under_investigation
    if (current.closureSignalCount === 0) {
      return {
        nextHealthStatus: 'under_investigation',
        nextLifecycleStatus: 'under_investigation',
        nextCheckDelayDays: 7,
        shouldCreateReviewTask: true,
        reviewReason: 'suspected_closure',
        suggestedAction: 'request_verification',
        closureConfirmed: false,
        explanation:
          'Multiple unreachable checks without explicit closure notice; placed under investigation for human verification.',
      };
    }
  }

  // 5. Explicit closure notice or corroborated closure signal
  const nextClosureSignals = current.closureSignalCount + 1;
  if (nextClosureSignals >= threshold) {
    return {
      nextHealthStatus: 'archived',
      nextLifecycleStatus: 'archived',
      nextCheckDelayDays: 90,
      shouldCreateReviewTask: false,
      reviewReason: null,
      suggestedAction: null,
      closureConfirmed: true,
      explanation: `Confirmed permanently closed after ${nextClosureSignals} corroborated closure signals (threshold ${threshold}); archived from public search with history preserved.`,
    };
  }

  return {
    nextHealthStatus: 'under_investigation',
    nextLifecycleStatus: 'under_investigation',
    nextCheckDelayDays: 5,
    shouldCreateReviewTask: true,
    reviewReason: 'suspected_closure',
    suggestedAction: 'archive_closed',
    closureConfirmed: false,
    explanation: `Closure signal ${nextClosureSignals}/${threshold} recorded; awaiting corroborating check or admin confirmation before archiving.`,
  };
}

export interface WebsiteMonitoringProbeResult {
  reachable: boolean;
  statusCode: number | null;
  closureNoticeDetected: boolean;
  relocationNoticeDetected: boolean;
  extractedPhones: string[];
  detectedSignals: string[];
  errorMessage: string | null;
}

/**
 * Safely probes a business's public website with SSRF guardrails and timeout to inspect
 * liveness, closure notices, relocation notices, and contact updates.
 */
export async function probeBusinessWebsite(
  websiteUrl: string,
  options: { fetchImpl?: typeof fetch; userAgent?: string } = {},
): Promise<WebsiteMonitoringProbeResult> {
  const safeUrl = validateSafeExternalFetchUrl(websiteUrl);
  const fetchFn = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetchFn(safeUrl, {
      method: 'GET',
      headers: {
        'User-Agent': options.userAgent ?? 'NaijaPagesMonitor/1.0 (+https://naijapages.ng)',
        Accept: 'text/html, text/plain',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (res.status >= 400) {
      return {
        reachable: false,
        statusCode: res.status,
        closureNoticeDetected: res.status === 410,
        relocationNoticeDetected: false,
        extractedPhones: [],
        detectedSignals: res.status === 410 ? ['http_410_gone'] : [`http_${res.status}`],
        errorMessage: `Website returned HTTP ${res.status}.`,
      };
    }

    const html = (await res.text()).slice(0, 256 * 1024);
    const extracted = extractStructuredFieldsFromText(html);
    return {
      reachable: true,
      statusCode: res.status,
      closureNoticeDetected: extracted.closureNoticeDetected,
      relocationNoticeDetected: extracted.relocationNoticeDetected,
      extractedPhones: extracted.phones,
      detectedSignals: extracted.detectedSignals,
      errorMessage: null,
    };
  } catch (err) {
    return {
      reachable: false,
      statusCode: null,
      closureNoticeDetected: false,
      relocationNoticeDetected: false,
      extractedPhones: [],
      detectedSignals: ['network_unreachable'],
      errorMessage: err instanceof Error ? err.message : 'Website probe failed.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function ensureMonitoringRecord(
  db: D1Database,
  params: {
    discoveredBusinessId?: string | null;
    businessId?: string | null;
    monitoringTier?: 'high_priority' | 'standard' | 'low_priority';
    checkIntervalDays?: number;
    now?: number;
  },
): Promise<string> {
  const now = params.now ?? Date.now();
  const intervalDays = Math.max(1, params.checkIntervalDays ?? 30);
  const existing = params.discoveredBusinessId
    ? await db
        .prepare('SELECT id FROM business_monitoring WHERE discovered_business_id = ?')
        .bind(params.discoveredBusinessId)
        .first<{ id: string }>()
    : await db
        .prepare('SELECT id FROM business_monitoring WHERE business_id = ?')
        .bind(params.businessId!)
        .first<{ id: string }>();

  if (existing) return existing.id;

  const id = `mon_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO business_monitoring (
        id, discovered_business_id, business_id, health_status, monitoring_tier,
        check_interval_days, last_verified_at, next_check_at,
        verification_attempts, failed_checks, consecutive_failures,
        closure_signal_count, closure_signals_json, last_known_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'healthy', ?, ?, ?, ?, 0, 0, 0, 0, '[]', 'active', ?, ?)`,
    )
    .bind(
      id,
      params.discoveredBusinessId ?? null,
      params.businessId ?? null,
      params.monitoringTier ?? 'standard',
      intervalDays,
      now,
      now + intervalDays * 86_400_000,
      now,
      now,
    )
    .run();
  return id;
}

/**
 * Applies a monitoring signal to D1 `business_monitoring`, updates candidate lifecycle state,
 * appends audit history in `business_change_history`, and creates a `bot_review_queue` task
 * whenever human confirmation is required.
 */
export async function applyMonitoringSignalToD1(
  db: D1Database,
  monitoringId: string,
  signal: MonitoringSignalInput,
  options: { closureConfirmThreshold?: number; actorEmail?: string } = {},
): Promise<MonitoringTransitionResult> {
  const now = signal.now ?? Date.now();
  const row = await db
    .prepare('SELECT * FROM business_monitoring WHERE id = ?')
    .bind(monitoringId)
    .first<{
      id: string;
      discovered_business_id: string | null;
      business_id: string | null;
      health_status: MonitoringHealthStatus;
      check_interval_days: number;
      verification_attempts: number;
      failed_checks: number;
      consecutive_failures: number;
      closure_signal_count: number;
      closure_signals_json: string;
    }>();

  if (!row) {
    throw new Error(`Monitoring record "${monitoringId}" not found.`);
  }

  let parsedSignals: Array<{ kind: string; detail: string; observedAt: number }> = [];
  try {
    parsedSignals = JSON.parse(row.closure_signals_json);
  } catch {
    parsedSignals = [];
  }

  const transition = evaluateMonitoringTransition(
    {
      healthStatus: row.health_status,
      checkIntervalDays: row.check_interval_days,
      verificationAttempts: row.verification_attempts,
      failedChecks: row.failed_checks,
      consecutiveFailures: row.consecutive_failures,
      closureSignalCount: row.closure_signal_count,
      closureSignals: parsedSignals,
    },
    signal,
    { closureConfirmThreshold: options.closureConfirmThreshold },
  );

  const isFailure =
    signal.kind === 'website_unreachable' ||
    signal.kind === 'source_removed' ||
    signal.kind === 'website_closure_notice' ||
    signal.kind === 'corroborated_closure';
  const isClosureSignal =
    signal.kind === 'website_closure_notice' || signal.kind === 'corroborated_closure';

  const nextSignals =
    signal.kind === 'check_passed'
      ? parsedSignals
      : [...parsedSignals.slice(-19), { kind: signal.kind, detail: signal.detail, observedAt: now }];

  const nextAttempts = row.verification_attempts + 1;
  const nextFailedChecks = row.failed_checks + (isFailure ? 1 : 0);
  const nextConsecutiveFailures = signal.kind === 'check_passed' ? 0 : row.consecutive_failures + (isFailure ? 1 : 0);
  const nextClosureCount = signal.kind === 'check_passed' ? 0 : row.closure_signal_count + (isClosureSignal ? 1 : 0);
  const nextCheckAt = now + transition.nextCheckDelayDays * 86_400_000;

  await db
    .prepare(
      `UPDATE business_monitoring
       SET health_status = ?,
           last_verified_at = ?,
           next_check_at = ?,
           verification_attempts = ?,
           failed_checks = ?,
           consecutive_failures = ?,
           closure_signal_count = ?,
           closure_signals_json = ?,
           last_known_status = ?,
           monitoring_notes = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      transition.nextHealthStatus,
      now,
      nextCheckAt,
      nextAttempts,
      nextFailedChecks,
      nextConsecutiveFailures,
      nextClosureCount,
      JSON.stringify(nextSignals),
      transition.nextLifecycleStatus,
      transition.explanation,
      now,
      monitoringId,
    )
    .run();

  if (row.discovered_business_id) {
    const nextReviewStatus = transition.closureConfirmed ? 'archived' : undefined;
    await db
      .prepare(
        `UPDATE discovered_businesses
         SET lifecycle_status = ?,
             review_status = COALESCE(?, review_status),
             last_checked_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        transition.nextLifecycleStatus,
        nextReviewStatus ?? null,
        now,
        now,
        row.discovered_business_id,
      )
      .run();
  }

  if (row.health_status !== transition.nextHealthStatus) {
    await recordBusinessChangeHistory(db, {
      discoveredBusinessId: row.discovered_business_id,
      businessId: row.business_id,
      fieldChanged: 'monitoring_health_status',
      oldValue: row.health_status,
      newValue: transition.nextHealthStatus,
      changeSource: 'monitoring_bot',
      actorEmail: options.actorEmail ?? 'system:monitoring-bot',
      reason: `${signal.kind}: ${signal.detail}`,
      appliedMode: 'automatic',
      now,
    });
  }

  if (transition.shouldCreateReviewTask && transition.reviewReason && transition.suggestedAction) {
    const existingTask = await db
      .prepare(
        `SELECT id FROM bot_review_queue
         WHERE review_status = 'pending'
           AND review_reason = ?
           AND (discovered_business_id = ? OR business_id = ?)`,
      )
      .bind(transition.reviewReason, row.discovered_business_id ?? '', row.business_id ?? '')
      .first<{ id: string }>();

    if (!existingTask) {
      await db
        .prepare(
          `INSERT INTO bot_review_queue (
            id, discovered_business_id, business_id, review_reason, confidence_score,
            duplicate_candidates_json, evidence_refs_json, suggested_action,
            review_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 0.5, '[]', ?, ?, 'pending', ?, ?)`,
        )
        .bind(
          `rev_${crypto.randomUUID()}`,
          row.discovered_business_id,
          row.business_id,
          transition.reviewReason,
          JSON.stringify([signal]),
          transition.suggestedAction,
          now,
          now,
        )
        .run();
    }
  }

  return transition;
}
