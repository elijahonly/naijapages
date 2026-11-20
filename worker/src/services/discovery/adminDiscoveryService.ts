/**
 * Administrative Business Intelligence service powering `/api/v1/admin/discovery/*`.
 *
 * Enforces:
 * - Admin-only access (called exclusively behind `requireAdmin`).
 * - Immutable audit logging (`audit_log`) and field change tracking (`business_change_history`).
 * - Safe controlled publishing, duplicate merging, branch separation, relocation updates,
 *   closure confirmation, and archive restoration without destroying historical evidence.
 */
import { cleanEmail, cleanPhone, cleanText, ValidationError } from '../../lib/validation';
import type { AuthSessionUser, DiscoveryQueueBinding } from '../../types';
import {
  getDiscoveryBotSettings,
  recordBusinessChangeHistory,
  updateDiscoveryBotSettings,
  type DiscoveryBotSettings,
} from './botSettingsService';
import { getNationalCoverageSummary, getNigeriaStateRef } from './coverageEngine';
import { createDiscoveryJob, enqueueDiscoveryJob, retryDiscoveryJob } from './jobService';
import { ensureMonitoringRecord } from './monitoring';
import { extractCanonicalDomain, normalizeNigerianPhone } from './normalization';
import { ensureDefaultDiscoverySources } from './sources/registry';

function auditStmt(
  db: D1Database,
  admin: AuthSessionUser,
  action: string,
  targetType: string,
  targetId: string,
  summary: string,
  now: number,
) {
  return db
    .prepare(
      `INSERT INTO audit_log (id, admin_id, admin_email, action, target_type, target_id, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), admin.id, admin.email, action, targetType, targetId, summary.slice(0, 500), now);
}

export async function getAdminDiscoveryOverview(db: D1Database) {
  await ensureDefaultDiscoverySources(db);

  const [
    memberCountRow,
    discCountsRow,
    reviewCountsRow,
    jobCountsRow,
    sourcesRes,
    coverage,
    settings,
  ] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS cnt FROM businesses WHERE status = 'approved'`)
      .first<{ cnt: number }>(),
    db
      .prepare(
        `SELECT
           COUNT(*) AS total_discovered,
           SUM(CASE WHEN lifecycle_status = 'published' AND review_status = 'approved' THEN 1 ELSE 0 END) AS published_count,
           SUM(CASE WHEN lifecycle_status IN ('discovered', 'pending_verification') THEN 1 ELSE 0 END) AS awaiting_verification,
           SUM(CASE WHEN review_status = 'needs_review' OR lifecycle_status = 'pending_admin_review' THEN 1 ELSE 0 END) AS awaiting_review,
           SUM(CASE WHEN review_status = 'duplicate' OR lifecycle_status = 'duplicate' THEN 1 ELSE 0 END) AS duplicate_count,
           SUM(CASE WHEN lifecycle_status IN ('potentially_outdated', 'under_investigation') THEN 1 ELSE 0 END) AS potentially_outdated,
           SUM(CASE WHEN lifecycle_status IN ('confirmed_closed', 'archived') THEN 1 ELSE 0 END) AS confirmed_closures
         FROM discovered_businesses`,
      )
      .first<{
        total_discovered: number;
        published_count: number;
        awaiting_verification: number;
        awaiting_review: number;
        duplicate_count: number;
        potentially_outdated: number;
        confirmed_closures: number;
      }>(),
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN review_status = 'pending' THEN 1 ELSE 0 END) AS pending_reviews,
           SUM(CASE WHEN review_status = 'pending' AND review_reason = 'possible_duplicate' THEN 1 ELSE 0 END) AS duplicate_candidates
         FROM bot_review_queue`,
      )
      .first<{ pending_reviews: number; duplicate_candidates: number }>(),
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN status IN ('queued', 'running') THEN 1 ELSE 0 END) AS running_jobs,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_jobs,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_jobs
         FROM discovery_jobs`,
      )
      .first<{ running_jobs: number; failed_jobs: number; completed_jobs: number }>(),
    db
      .prepare(
        `SELECT id, name, source_type, base_url, licence_name, licence_url, attribution_text,
                permission_status, enabled, rate_limit_per_minute, integration_type,
                health_status, reliability_score, consecutive_failures, circuit_open_until,
                last_successful_sync, last_failed_sync, last_error, updated_at
         FROM discovery_sources
         ORDER BY enabled DESC, name ASC`,
      )
      .all(),
    getNationalCoverageSummary(db),
    getDiscoveryBotSettings(db),
  ]);

  const memberListings = Number(memberCountRow?.cnt ?? 0);
  const publishedBotListings = Number(discCountsRow?.published_count ?? 0);

  return {
    metrics: {
      totalAuthenticListings: memberListings + publishedBotListings,
      memberListings,
      newlyDiscovered: Number(discCountsRow?.total_discovered ?? 0),
      businessesPublished: publishedBotListings,
      awaitingVerification: Number(discCountsRow?.awaiting_verification ?? 0),
      awaitingReview: Math.max(
        Number(discCountsRow?.awaiting_review ?? 0),
        Number(reviewCountsRow?.pending_reviews ?? 0),
      ),
      duplicateCandidates: Math.max(
        Number(discCountsRow?.duplicate_count ?? 0),
        Number(reviewCountsRow?.duplicate_candidates ?? 0),
      ),
      potentiallyOutdated: Number(discCountsRow?.potentially_outdated ?? 0),
      confirmedClosures: Number(discCountsRow?.confirmed_closures ?? 0),
      discoveryJobsRunning: Number(jobCountsRow?.running_jobs ?? 0),
      failedJobs: Number(jobCountsRow?.failed_jobs ?? 0),
      completedJobs: Number(jobCountsRow?.completed_jobs ?? 0),
    },
    sources: (sourcesRes.results ?? []).map((s: Record<string, unknown>) => ({
      id: String(s.id),
      name: String(s.name),
      sourceType: String(s.source_type),
      baseUrl: String(s.base_url),
      licenceName: String(s.licence_name),
      licenceUrl: s.licence_url ? String(s.licence_url) : null,
      attributionText: s.attribution_text ? String(s.attribution_text) : null,
      permissionStatus: String(s.permission_status),
      enabled: Boolean(s.enabled),
      rateLimitPerMinute: Number(s.rate_limit_per_minute) || 30,
      integrationType: String(s.integration_type ?? 'api'),
      healthStatus: String(s.health_status ?? 'unknown'),
      reliabilityScore: Number(s.reliability_score ?? 0.65),
      consecutiveFailures: Number(s.consecutive_failures ?? 0),
      circuitOpenUntil: s.circuit_open_until ? Number(s.circuit_open_until) : null,
      lastSuccessfulSync: s.last_successful_sync ? Number(s.last_successful_sync) : null,
      lastFailedSync: s.last_failed_sync ? Number(s.last_failed_sync) : null,
      lastError: s.last_error ? String(s.last_error) : null,
    })),
    coverage,
    settings,
  };
}

export async function listAdminReviewQueue(
  db: D1Database,
  options: { status?: string; limit?: number } = {},
) {
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const status = options.status ?? 'pending';

  const queueRes = await db
    .prepare(
      `SELECT q.*,
              d.name AS candidate_name,
              d.category AS candidate_category,
              d.state AS candidate_state,
              d.lga AS candidate_lga,
              d.address AS candidate_address,
              d.phone AS candidate_phone,
              d.website AS candidate_website,
              d.email AS candidate_email,
              d.opening_hours AS candidate_opening_hours,
              d.source_id AS candidate_source_id,
              d.source_url AS candidate_source_url,
              d.verification_tier AS candidate_verification_tier,
              d.lifecycle_status AS candidate_lifecycle_status,
              d.corroborating_source_count AS candidate_source_count,
              d.attribution_text AS candidate_attribution
       FROM bot_review_queue q
       LEFT JOIN discovered_businesses d ON d.id = q.discovered_business_id
       WHERE (? = 'all' OR q.review_status = ?)
       ORDER BY q.created_at DESC
       LIMIT ?`,
    )
    .bind(status, status, limit)
    .all<Record<string, unknown>>();

  const items = [];
  for (const row of queueRes.results ?? []) {
    const discId = row.discovered_business_id ? String(row.discovered_business_id) : null;
    let evidence: Array<Record<string, unknown>> = [];
    if (discId) {
      const evRes = await db
        .prepare(
          `SELECT id, source_id, evidence_type, field_name, evidence_value, source_url,
                  confidence, attribution_text, licence_reference, notes, collected_at
           FROM business_evidence
           WHERE discovered_business_id = ?
           ORDER BY collected_at DESC
           LIMIT 25`,
        )
        .bind(discId)
        .all<Record<string, unknown>>();
      evidence = evRes.results ?? [];
    }

    let duplicateCandidates: unknown[] = [];
    try {
      duplicateCandidates = JSON.parse(String(row.duplicate_candidates_json ?? '[]'));
    } catch {
      duplicateCandidates = [];
    }

    items.push({
      id: String(row.id),
      discoveredBusinessId: discId,
      businessId: row.business_id ? String(row.business_id) : null,
      reviewReason: String(row.review_reason),
      confidenceScore: Number(row.confidence_score ?? 0),
      suggestedAction: String(row.suggested_action),
      reviewStatus: String(row.review_status),
      adminDecision: row.admin_decision ? String(row.admin_decision) : null,
      adminNote: row.admin_note ? String(row.admin_note) : null,
      createdAt: Number(row.created_at),
      candidate: discId
        ? {
            id: discId,
            name: String(row.candidate_name ?? ''),
            category: row.candidate_category ? String(row.candidate_category) : null,
            state: row.candidate_state ? String(row.candidate_state) : null,
            lga: row.candidate_lga ? String(row.candidate_lga) : null,
            address: row.candidate_address ? String(row.candidate_address) : null,
            phone: row.candidate_phone ? String(row.candidate_phone) : null,
            website: row.candidate_website ? String(row.candidate_website) : null,
            email: row.candidate_email ? String(row.candidate_email) : null,
            openingHours: row.candidate_opening_hours ? String(row.candidate_opening_hours) : null,
            sourceId: row.candidate_source_id ? String(row.candidate_source_id) : null,
            sourceUrl: row.candidate_source_url ? String(row.candidate_source_url) : null,
            verificationTier: String(row.candidate_verification_tier ?? 'discovered'),
            lifecycleStatus: String(row.candidate_lifecycle_status ?? 'discovered'),
            corroboratingSourceCount: Number(row.candidate_source_count ?? 1),
            attributionText: row.candidate_attribution ? String(row.candidate_attribution) : null,
          }
        : null,
      duplicateCandidates,
      evidence,
    });
  }

  return items;
}

export type AdminReviewAction =
  | 'approve_publish'
  | 'reject'
  | 'merge_duplicate'
  | 'keep_separate_branch'
  | 'edit_candidate'
  | 'request_verification'
  | 'confirm_relocation'
  | 'confirm_closure'
  | 'restore_archived';

export async function decideAdminReviewQueueItem(
  db: D1Database,
  admin: AuthSessionUser,
  reviewId: string,
  payload: {
    action: AdminReviewAction;
    note?: string;
    edits?: {
      name?: string;
      category?: string;
      state?: string;
      lga?: string;
      address?: string;
      phone?: string;
      website?: string;
      email?: string;
    };
  },
) {
  const now = Date.now();
  const item = await db
    .prepare('SELECT * FROM bot_review_queue WHERE id = ?')
    .bind(reviewId)
    .first<{
      id: string;
      discovered_business_id: string | null;
      business_id: string | null;
      review_reason: string;
      review_status: string;
    }>();

  if (!item) {
    throw new ValidationError('Review queue task was not found.', 404, 'NOT_FOUND');
  }

  const note = cleanText(payload.note ?? '', 500) || null;
  const discId = item.discovered_business_id;

  if (discId && payload.edits) {
    const e = payload.edits;
    const existing = await db
      .prepare('SELECT name, category, state, lga, address, phone, website, email FROM discovered_businesses WHERE id = ?')
      .bind(discId)
      .first<Record<string, string | null>>();

    if (existing) {
      const nextName = e.name ? cleanText(e.name, 140) : existing.name;
      const nextCat = e.category ? cleanText(e.category, 60) : existing.category;
      const nextState = e.state ? cleanText(e.state, 60) : existing.state;
      const nextLga = e.lga !== undefined ? cleanText(e.lga, 80) || null : existing.lga;
      const nextAddr = e.address !== undefined ? cleanText(e.address, 240) || null : existing.address;
      const nextPhone = e.phone !== undefined ? (cleanPhone(e.phone) || null) : existing.phone;
      const nextNormPhone = nextPhone ? (normalizeNigerianPhone(nextPhone)?.e164 ?? null) : null;
      const nextWebsite = e.website !== undefined ? cleanText(e.website, 300) || null : existing.website;
      const nextDomain = nextWebsite ? extractCanonicalDomain(nextWebsite) : null;
      const nextEmail = e.email !== undefined ? (cleanEmail(e.email) || null) : existing.email;

      await db
        .prepare(
          `UPDATE discovered_businesses
           SET name = ?, category = ?, state = ?, lga = ?, address = ?,
               phone = ?, normalized_phone = ?, website = ?, canonical_domain = ?, email = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          nextName,
          nextCat,
          nextState,
          nextLga,
          nextAddr,
          nextPhone,
          nextNormPhone,
          nextWebsite,
          nextDomain,
          nextEmail,
          now,
          discId,
        )
        .run();

      await recordBusinessChangeHistory(db, {
        discoveredBusinessId: discId,
        fieldChanged: 'admin_edit',
        oldValue: JSON.stringify(existing),
        newValue: JSON.stringify({
          name: nextName,
          category: nextCat,
          state: nextState,
          lga: nextLga,
          address: nextAddr,
          phone: nextPhone,
          website: nextWebsite,
        }),
        changeSource: 'admin_review',
        actorId: admin.id,
        actorEmail: admin.email,
        reason: note ?? 'Admin updated candidate fields during review.',
        appliedMode: 'admin_approved',
        now,
      });
    }
  }

  let nextQueueStatus = 'approved';
  let summary = `Admin ${payload.action} on review item ${reviewId}`;

  switch (payload.action) {
    case 'approve_publish':
    case 'keep_separate_branch': {
      if (discId) {
        await db
          .prepare(
            `UPDATE discovered_businesses
             SET review_status = 'approved',
                 lifecycle_status = 'published',
                 verification_tier = CASE
                   WHEN verification_tier = 'discovered' THEN 'evidence_checked'
                   ELSE verification_tier
                 END,
                 verified_at = ?,
                 verification_notes = COALESCE(?, verification_notes),
                 updated_at = ?
             WHERE id = ?`,
          )
          .bind(now, note, now, discId)
          .run();

        await ensureMonitoringRecord(db, { discoveredBusinessId: discId, now });
        await recordBusinessChangeHistory(db, {
          discoveredBusinessId: discId,
          fieldChanged: 'lifecycle_status',
          oldValue: 'pending_admin_review',
          newValue: 'published',
          changeSource: 'admin_review',
          actorId: admin.id,
          actorEmail: admin.email,
          reason: note ?? `Approved via ${payload.action}.`,
          appliedMode: 'admin_approved',
          now,
        });
      }
      nextQueueStatus = 'approved';
      summary = `Published discovered candidate ${discId ?? reviewId}`;
      break;
    }

    case 'merge_duplicate': {
      if (discId) {
        await db
          .prepare(
            `UPDATE discovered_businesses
             SET review_status = 'duplicate',
                 lifecycle_status = 'duplicate',
                 verification_notes = ?,
                 updated_at = ?
             WHERE id = ?`,
          )
          .bind(note ?? 'Marked duplicate by administrator.', now, discId)
          .run();
        await recordBusinessChangeHistory(db, {
          discoveredBusinessId: discId,
          fieldChanged: 'lifecycle_status',
          oldValue: 'pending_admin_review',
          newValue: 'duplicate',
          changeSource: 'admin_review',
          actorId: admin.id,
          actorEmail: admin.email,
          reason: note ?? 'Merged duplicate candidate.',
          appliedMode: 'admin_approved',
          now,
        });
      }
      nextQueueStatus = 'merged';
      summary = `Merged duplicate candidate ${discId ?? reviewId}`;
      break;
    }

    case 'reject': {
      if (discId) {
        await db
          .prepare(
            `UPDATE discovered_businesses
             SET review_status = 'rejected',
                 lifecycle_status = 'rejected',
                 verification_notes = ?,
                 updated_at = ?
             WHERE id = ?`,
          )
          .bind(note ?? 'Rejected by administrator.', now, discId)
          .run();
        await recordBusinessChangeHistory(db, {
          discoveredBusinessId: discId,
          fieldChanged: 'lifecycle_status',
          oldValue: 'pending_admin_review',
          newValue: 'rejected',
          changeSource: 'admin_review',
          actorId: admin.id,
          actorEmail: admin.email,
          reason: note ?? 'Rejected candidate.',
          appliedMode: 'admin_approved',
          now,
        });
      }
      nextQueueStatus = 'rejected';
      summary = `Rejected candidate ${discId ?? reviewId}`;
      break;
    }

    case 'request_verification': {
      if (discId) {
        await db
          .prepare(
            `UPDATE discovered_businesses
             SET lifecycle_status = 'pending_verification',
                 verification_notes = ?,
                 updated_at = ?
             WHERE id = ?`,
          )
          .bind(note ?? 'Additional verification requested by admin.', now, discId)
          .run();
      }
      nextQueueStatus = 'in_review';
      summary = `Requested additional verification for ${discId ?? reviewId}`;
      break;
    }

    case 'confirm_relocation': {
      if (discId) {
        await db
          .prepare(
            `UPDATE discovered_businesses
             SET lifecycle_status = 'published',
                 review_status = 'approved',
                 verification_notes = ?,
                 updated_at = ?
             WHERE id = ?`,
          )
          .bind(note ?? 'Relocation confirmed and address updated by admin.', now, discId)
          .run();
        await db
          .prepare(
            `UPDATE business_monitoring
             SET health_status = 'healthy',
                 consecutive_failures = 0,
                 closure_signal_count = 0,
                 monitoring_notes = ?,
                 updated_at = ?
             WHERE discovered_business_id = ?`,
          )
          .bind(note ?? 'Relocation confirmed by admin.', now, discId)
          .run();
        await recordBusinessChangeHistory(db, {
          discoveredBusinessId: discId,
          fieldChanged: 'relocation_confirmed',
          oldValue: 'relocated',
          newValue: 'published',
          changeSource: 'admin_review',
          actorId: admin.id,
          actorEmail: admin.email,
          reason: note ?? 'Admin confirmed business relocation.',
          appliedMode: 'admin_approved',
          now,
        });
      }
      nextQueueStatus = 'approved';
      summary = `Confirmed relocation for ${discId ?? reviewId}`;
      break;
    }

    case 'confirm_closure': {
      if (discId) {
        await db
          .prepare(
            `UPDATE discovered_businesses
             SET lifecycle_status = 'archived',
                 review_status = 'archived',
                 verification_notes = ?,
                 updated_at = ?
             WHERE id = ?`,
          )
          .bind(note ?? 'Confirmed permanently closed by administrator.', now, discId)
          .run();
        await db
          .prepare(
            `UPDATE business_monitoring
             SET health_status = 'archived',
                 last_known_status = 'confirmed_closed',
                 monitoring_notes = ?,
                 updated_at = ?
             WHERE discovered_business_id = ?`,
          )
          .bind(note ?? 'Confirmed closed and archived by administrator.', now, discId)
          .run();
        await recordBusinessChangeHistory(db, {
          discoveredBusinessId: discId,
          fieldChanged: 'lifecycle_status',
          oldValue: 'under_investigation',
          newValue: 'archived',
          changeSource: 'admin_review',
          actorId: admin.id,
          actorEmail: admin.email,
          reason: note ?? 'Confirmed permanently closed and archived (history preserved).',
          appliedMode: 'admin_approved',
          now,
        });
      }
      nextQueueStatus = 'approved';
      summary = `Confirmed closure & archived ${discId ?? reviewId}`;
      break;
    }

    case 'restore_archived': {
      if (discId) {
        await db
          .prepare(
            `UPDATE discovered_businesses
             SET lifecycle_status = 'published',
                 review_status = 'approved',
                 verification_notes = ?,
                 updated_at = ?
             WHERE id = ?`,
          )
          .bind(note ?? 'Restored from archive by administrator.', now, discId)
          .run();
        await db
          .prepare(
            `UPDATE business_monitoring
             SET health_status = 'healthy',
                 consecutive_failures = 0,
                 closure_signal_count = 0,
                 last_known_status = 'active',
                 monitoring_notes = ?,
                 updated_at = ?
             WHERE discovered_business_id = ?`,
          )
          .bind(note ?? 'Restored from archive.', now, discId)
          .run();
        await recordBusinessChangeHistory(db, {
          discoveredBusinessId: discId,
          fieldChanged: 'lifecycle_status',
          oldValue: 'archived',
          newValue: 'published',
          changeSource: 'admin_review',
          actorId: admin.id,
          actorEmail: admin.email,
          reason: note ?? 'Restored archived listing.',
          appliedMode: 'admin_approved',
          now,
        });
      }
      nextQueueStatus = 'approved';
      summary = `Restored archived listing ${discId ?? reviewId}`;
      break;
    }

    case 'edit_candidate': {
      nextQueueStatus = item.review_status;
      summary = `Edited candidate ${discId ?? reviewId}`;
      break;
    }
  }

  await db.batch([
    db
      .prepare(
        `UPDATE bot_review_queue
         SET review_status = ?,
             admin_decision = ?,
             admin_note = COALESCE(?, admin_note),
             decided_by = ?,
             decided_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(nextQueueStatus, payload.action, note, admin.email, now, now, reviewId),
    auditStmt(db, admin, `discovery.review.${payload.action}`, 'bot_review_queue', reviewId, summary, now),
  ]);

  return { updated: true, reviewStatus: nextQueueStatus };
}

export async function updateAdminDiscoverySource(
  db: D1Database,
  admin: AuthSessionUser,
  sourceId: string,
  patch: {
    permissionStatus?: 'pending_review' | 'approved' | 'restricted' | 'rejected' | 'revoked';
    enabled?: boolean;
    rateLimitPerMinute?: number;
    resetCircuitBreaker?: boolean;
  },
) {
  const now = Date.now();
  const existing = await db
    .prepare('SELECT id, permission_status, enabled, rate_limit_per_minute FROM discovery_sources WHERE id = ?')
    .bind(sourceId)
    .first<{ id: string; permission_status: string; enabled: number; rate_limit_per_minute: number }>();

  if (!existing) {
    throw new ValidationError('Discovery source not found.', 404, 'NOT_FOUND');
  }

  const nextPermission = patch.permissionStatus ?? existing.permission_status;
  let nextEnabled = patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled;
  if (nextPermission !== 'approved') {
    nextEnabled = 0; // Enforce DB CHECK constraint strictly
  }
  const nextRateLimit =
    patch.rateLimitPerMinute !== undefined
      ? Math.max(1, Math.min(300, Math.trunc(patch.rateLimitPerMinute)))
      : existing.rate_limit_per_minute;

  const stmts = [
    db
      .prepare(
        `UPDATE discovery_sources
         SET permission_status = ?,
             enabled = ?,
             rate_limit_per_minute = ?,
             consecutive_failures = CASE WHEN ? = 1 THEN 0 ELSE consecutive_failures END,
             circuit_open_until = CASE WHEN ? = 1 THEN NULL ELSE circuit_open_until END,
             health_status = CASE WHEN ? = 1 THEN 'healthy' ELSE health_status END,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        nextPermission,
        nextEnabled,
        nextRateLimit,
        patch.resetCircuitBreaker ? 1 : 0,
        patch.resetCircuitBreaker ? 1 : 0,
        patch.resetCircuitBreaker ? 1 : 0,
        now,
        sourceId,
      ),
    auditStmt(
      db,
      admin,
      'discovery.source.update',
      'discovery_source',
      sourceId,
      `Source ${sourceId}: permission=${nextPermission}, enabled=${Boolean(nextEnabled)}, rateLimit=${nextRateLimit}/min`,
      now,
    ),
  ];

  await db.batch(stmts);
  return { id: sourceId, permissionStatus: nextPermission, enabled: Boolean(nextEnabled) };
}

export async function listAdminDiscoveryJobs(db: D1Database, limit = 50) {
  const safeLimit = Math.min(200, Math.max(1, limit));
  const res = await db
    .prepare(
      `SELECT id, source_id, job_type, country, state, lga, category, status, priority,
              attempts, discovered_count, processed_count, accepted_count, rejected_count,
              duplicate_count, error_count, error_message, created_at, started_at, completed_at
       FROM discovery_jobs
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(safeLimit)
    .all<Record<string, unknown>>();
  return (res.results ?? []).map((r) => ({
    id: String(r.id),
    sourceId: String(r.source_id),
    jobType: String(r.job_type),
    state: r.state ? String(r.state) : null,
    lga: r.lga ? String(r.lga) : null,
    category: r.category ? String(r.category) : null,
    status: String(r.status),
    priority: Number(r.priority ?? 100),
    attempts: Number(r.attempts ?? 0),
    discoveredCount: Number(r.discovered_count ?? 0),
    processedCount: Number(r.processed_count ?? 0),
    acceptedCount: Number(r.accepted_count ?? 0),
    rejectedCount: Number(r.rejected_count ?? 0),
    duplicateCount: Number(r.duplicate_count ?? 0),
    errorCount: Number(r.error_count ?? 0),
    errorMessage: r.error_message ? String(r.error_message) : null,
    createdAt: Number(r.created_at),
    startedAt: r.started_at ? Number(r.started_at) : null,
    completedAt: r.completed_at ? Number(r.completed_at) : null,
  }));
}

export async function runManualAdminDiscoveryJob(
  db: D1Database,
  queue: DiscoveryQueueBinding | undefined,
  admin: AuthSessionUser,
  input: {
    sourceId: string;
    state: string;
    lga?: string;
    category?: string;
    maxResults?: number;
    endpointUrl?: string;
  },
) {
  const now = Date.now();
  const stateRef = getNigeriaStateRef(input.state);
  if (!stateRef) {
    throw new ValidationError(`Unknown Nigerian state "${input.state}".`, 400, 'INVALID_STATE');
  }

  const lga = cleanText(input.lga ?? '', 80) || stateRef.lgas[0] || stateRef.capital;
  const category = cleanText(input.category ?? '', 60) || undefined;

  const { job } = await createDiscoveryJob(db, {
    sourceId: input.sourceId,
    jobType: 'lga_sweep',
    country: 'Nigeria',
    state: stateRef.name,
    lga,
    category,
    geographicFilter: { bbox: stateRef.pilotBbox },
    searchParameters: {
      maxResults: Math.min(200, Math.max(1, Math.trunc(input.maxResults ?? 50))),
      endpointUrl: input.endpointUrl?.trim() || undefined,
      triggeredBy: admin.email,
    },
    priority: 25,
    requireApprovedSource: true,
    now,
  });

  let enqueued = false;
  if (queue) {
    await enqueueDiscoveryJob(db, queue, job.id, {
      correlationId: `admin:${admin.id}:${job.id}`,
      now,
    });
    enqueued = true;
  }

  await auditStmt(
    db,
    admin,
    'discovery.job.manual_run',
    'discovery_job',
    job.id,
    `Manual discovery job created for ${input.sourceId} (${stateRef.name} / ${lga})`,
    now,
  ).run();

  return { job, enqueued };
}

export async function retryAdminDiscoveryJob(
  db: D1Database,
  queue: DiscoveryQueueBinding | undefined,
  admin: AuthSessionUser,
  jobId: string,
) {
  const now = Date.now();
  let job;
  let enqueued = false;

  if (queue) {
    const res = await retryDiscoveryJob(db, queue, jobId, {
      resetAttempts: true,
      correlationId: `admin-retry:${admin.id}:${jobId}`,
      now,
    });
    job = res.job;
    enqueued = true;
  } else {
    await db
      .prepare(
        `UPDATE discovery_jobs
         SET status = 'queued', attempts = 0, completed_at = NULL, error_message = NULL, updated_at = ?
         WHERE id = ? AND status IN ('failed', 'partially_completed', 'queued')`,
      )
      .bind(now, jobId)
      .run();
    const row = await db.prepare('SELECT id, status, attempts FROM discovery_jobs WHERE id = ?').bind(jobId).first();
    if (!row) {
      throw new ValidationError('Discovery job not found.', 404, 'NOT_FOUND');
    }
    job = row;
  }

  await auditStmt(
    db,
    admin,
    'discovery.job.retry',
    'discovery_job',
    jobId,
    `Retried failed discovery job ${jobId}`,
    now,
  ).run();
  return { job, enqueued };
}

export async function listAdminMonitoringRecords(db: D1Database, limit = 60) {
  const safeLimit = Math.min(200, Math.max(1, limit));
  const res = await db
    .prepare(
      `SELECT m.*,
              d.name AS discovered_name,
              d.state AS discovered_state,
              d.lga AS discovered_lga,
              d.lifecycle_status AS discovered_lifecycle,
              b.name AS business_name,
              b.state AS business_state,
              b.lga AS business_lga
       FROM business_monitoring m
       LEFT JOIN discovered_businesses d ON d.id = m.discovered_business_id
       LEFT JOIN businesses b ON b.id = m.business_id
       ORDER BY m.updated_at DESC
       LIMIT ?`,
    )
    .bind(safeLimit)
    .all<Record<string, unknown>>();

  return (res.results ?? []).map((r) => ({
    id: String(r.id),
    discoveredBusinessId: r.discovered_business_id ? String(r.discovered_business_id) : null,
    businessId: r.business_id ? String(r.business_id) : null,
    businessName: String(r.discovered_name ?? r.business_name ?? 'Unnamed listing'),
    state: String(r.discovered_state ?? r.business_state ?? ''),
    lga: String(r.discovered_lga ?? r.business_lga ?? ''),
    healthStatus: String(r.health_status),
    monitoringTier: String(r.monitoring_tier),
    checkIntervalDays: Number(r.check_interval_days ?? 30),
    verificationAttempts: Number(r.verification_attempts ?? 0),
    failedChecks: Number(r.failed_checks ?? 0),
    consecutiveFailures: Number(r.consecutive_failures ?? 0),
    closureSignalCount: Number(r.closure_signal_count ?? 0),
    lastKnownStatus: String(r.last_known_status ?? 'active'),
    monitoringNotes: r.monitoring_notes ? String(r.monitoring_notes) : null,
    lastVerifiedAt: r.last_verified_at ? Number(r.last_verified_at) : null,
    nextCheckAt: Number(r.next_check_at),
  }));
}

export async function actOnAdminMonitoringRecord(
  db: D1Database,
  admin: AuthSessionUser,
  monitoringId: string,
  action: 'confirm_closure' | 'confirm_relocation' | 'restore_archived' | 'mark_healthy',
  note?: string,
) {
  const now = Date.now();
  const row = await db
    .prepare('SELECT id, discovered_business_id, business_id, health_status FROM business_monitoring WHERE id = ?')
    .bind(monitoringId)
    .first<{ id: string; discovered_business_id: string | null; business_id: string | null; health_status: string }>();
  if (!row) throw new ValidationError('Monitoring record not found.', 404, 'NOT_FOUND');

  const cleanNote = cleanText(note ?? '', 500) || null;
  const nextHealth = action === 'confirm_closure' ? 'archived' : 'healthy';
  const nextLifecycle = action === 'confirm_closure' ? 'archived' : 'published';
  const nextReview = action === 'confirm_closure' ? 'archived' : 'approved';

  await db
    .prepare(
      `UPDATE business_monitoring
       SET health_status = ?,
           consecutive_failures = CASE WHEN ? = 'healthy' THEN 0 ELSE consecutive_failures END,
           closure_signal_count = CASE WHEN ? = 'healthy' THEN 0 ELSE closure_signal_count END,
           last_known_status = ?,
           monitoring_notes = COALESCE(?, monitoring_notes),
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(nextHealth, nextHealth, nextHealth, nextLifecycle, cleanNote, now, monitoringId)
    .run();

  if (row.discovered_business_id) {
    await db
      .prepare(
        `UPDATE discovered_businesses
         SET lifecycle_status = ?,
             review_status = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(nextLifecycle, nextReview, now, row.discovered_business_id)
      .run();
  }

  await recordBusinessChangeHistory(db, {
    discoveredBusinessId: row.discovered_business_id,
    businessId: row.business_id,
    fieldChanged: 'monitoring_action',
    oldValue: row.health_status,
    newValue: nextHealth,
    changeSource: 'admin_review',
    actorId: admin.id,
    actorEmail: admin.email,
    reason: cleanNote ?? `Admin executed ${action}.`,
    appliedMode: 'admin_approved',
    now,
  });

  await auditStmt(
    db,
    admin,
    `discovery.monitoring.${action}`,
    'business_monitoring',
    monitoringId,
    `Monitoring ${action} on ${monitoringId}`,
    now,
  ).run();

  return { updated: true, healthStatus: nextHealth };
}

export async function listAdminBotHistory(db: D1Database, limit = 100) {
  const safeLimit = Math.min(250, Math.max(1, limit));
  const res = await db
    .prepare(
      `SELECT id, discovered_business_id, business_id, field_changed, old_value, new_value,
              change_source, actor_email, reason, applied_mode, created_at
       FROM business_change_history
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(safeLimit)
    .all<Record<string, unknown>>();
  return (res.results ?? []).map((r) => ({
    id: String(r.id),
    discoveredBusinessId: r.discovered_business_id ? String(r.discovered_business_id) : null,
    businessId: r.business_id ? String(r.business_id) : null,
    fieldChanged: String(r.field_changed),
    oldValue: r.old_value ? String(r.old_value) : null,
    newValue: r.new_value ? String(r.new_value) : null,
    changeSource: String(r.change_source),
    actorEmail: r.actor_email ? String(r.actor_email) : null,
    reason: r.reason ? String(r.reason) : null,
    appliedMode: String(r.applied_mode),
    createdAt: Number(r.created_at),
  }));
}

export async function saveAdminDiscoverySettings(
  db: D1Database,
  admin: AuthSessionUser,
  patch: Partial<Omit<DiscoveryBotSettings, 'updatedBy' | 'updatedAt'>>,
) {
  const now = Date.now();
  const updated = await updateDiscoveryBotSettings(db, patch, admin.email, now);
  await auditStmt(
    db,
    admin,
    'discovery.settings.update',
    'discovery_bot_settings',
    'default',
    `Updated discovery bot settings (globalPaused=${updated.globalPaused}, discoveryPaused=${updated.discoveryPaused}, monitoringPaused=${updated.monitoringPaused}, dailyLimit=${updated.dailyJobLimit})`,
    now,
  ).run();
  return updated;
}
