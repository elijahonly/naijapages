-- =============================================================================
-- Migration 0005: Nationwide Business Discovery Intelligence, Verification,
-- Deduplication, Coverage Matrix, Review Queue, Monitoring & Audit History
--
-- Extends Migration 0004 without altering or weakening member-submitted
-- `businesses`, `user`, `marketplace_items`, `reviews`, or `claims` data.
-- Reversible rollback statements are documented in
-- `docs/business-discovery/migrations-rollback.sql`.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 1. Extend `discovery_sources` with integration, reliability & circuit breaker
-- -----------------------------------------------------------------------------
ALTER TABLE discovery_sources ADD COLUMN integration_type TEXT NOT NULL DEFAULT 'api';
ALTER TABLE discovery_sources ADD COLUMN health_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE discovery_sources ADD COLUMN reliability_score REAL NOT NULL DEFAULT 0.65;
ALTER TABLE discovery_sources ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discovery_sources ADD COLUMN circuit_open_until INTEGER;
ALTER TABLE discovery_sources ADD COLUMN update_frequency TEXT DEFAULT 'daily';

-- -----------------------------------------------------------------------------
-- 2. Extend `discovered_businesses` with controlled publishing & lifecycle state
-- -----------------------------------------------------------------------------
ALTER TABLE discovered_businesses ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'discovered';
ALTER TABLE discovered_businesses ADD COLUMN published_business_id TEXT REFERENCES businesses(id) ON DELETE SET NULL;
ALTER TABLE discovered_businesses ADD COLUMN corroborating_source_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE discovered_businesses ADD COLUMN verification_tier TEXT NOT NULL DEFAULT 'discovered';
ALTER TABLE discovered_businesses ADD COLUMN verified_at INTEGER;
ALTER TABLE discovered_businesses ADD COLUMN verification_notes TEXT;
ALTER TABLE discovered_businesses ADD COLUMN attribution_text TEXT;
ALTER TABLE discovered_businesses ADD COLUMN source_licence_url TEXT;
ALTER TABLE discovered_businesses ADD COLUMN canonical_domain TEXT;
ALTER TABLE discovered_businesses ADD COLUMN normalized_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_discovered_businesses_lifecycle
  ON discovered_businesses (lifecycle_status, review_status, confidence_score DESC);

CREATE INDEX IF NOT EXISTS idx_discovered_businesses_norm_phone
  ON discovered_businesses (normalized_phone);

CREATE INDEX IF NOT EXISTS idx_discovered_businesses_domain
  ON discovered_businesses (canonical_domain);

CREATE INDEX IF NOT EXISTS idx_discovered_businesses_published_link
  ON discovered_businesses (published_business_id);

-- -----------------------------------------------------------------------------
-- 3. Extend `discovery_jobs` with processed_count
-- -----------------------------------------------------------------------------
ALTER TABLE discovery_jobs ADD COLUMN processed_count INTEGER NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------------------
-- 4. Extend `businesses` with optional provenance & verification tier metadata
--    (all existing member-submitted listings default to `member_submitted`)
-- -----------------------------------------------------------------------------
ALTER TABLE businesses ADD COLUMN origin_type TEXT NOT NULL DEFAULT 'member_submitted';
ALTER TABLE businesses ADD COLUMN verification_tier TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE businesses ADD COLUMN source_attribution TEXT;
ALTER TABLE businesses ADD COLUMN source_licence_url TEXT;
ALTER TABLE businesses ADD COLUMN discovered_business_id TEXT;

CREATE INDEX IF NOT EXISTS idx_businesses_origin_status
  ON businesses (origin_type, status);

-- -----------------------------------------------------------------------------
-- 5. Business Monitoring (Progressive Health, Relocation & Closure Tracking)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_monitoring (
  id TEXT PRIMARY KEY CHECK (LENGTH(TRIM(id)) > 0),
  discovered_business_id TEXT REFERENCES discovered_businesses(id) ON DELETE CASCADE,
  business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  health_status TEXT NOT NULL DEFAULT 'healthy' CHECK (
    health_status IN (
      'healthy',
      'watch',
      'potentially_outdated',
      'under_investigation',
      'relocated',
      'confirmed_closed',
      'archived'
    )
  ),
  monitoring_tier TEXT NOT NULL DEFAULT 'standard' CHECK (
    monitoring_tier IN ('high_priority', 'standard', 'low_priority')
  ),
  check_interval_days INTEGER NOT NULL DEFAULT 30 CHECK (check_interval_days > 0),
  last_verified_at INTEGER CHECK (last_verified_at IS NULL OR last_verified_at >= 0),
  next_check_at INTEGER NOT NULL CHECK (next_check_at >= 0),
  verification_attempts INTEGER NOT NULL DEFAULT 0 CHECK (verification_attempts >= 0),
  failed_checks INTEGER NOT NULL DEFAULT 0 CHECK (failed_checks >= 0),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  closure_signal_count INTEGER NOT NULL DEFAULT 0 CHECK (closure_signal_count >= 0),
  closure_signals_json TEXT NOT NULL DEFAULT '[]',
  last_known_status TEXT NOT NULL DEFAULT 'active',
  monitoring_notes TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  CHECK (discovered_business_id IS NOT NULL OR business_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_monitoring_discovered_unique
  ON business_monitoring (discovered_business_id)
  WHERE discovered_business_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_monitoring_business_unique
  ON business_monitoring (business_id)
  WHERE business_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_monitoring_due
  ON business_monitoring (health_status, next_check_at ASC);

-- -----------------------------------------------------------------------------
-- 6. Business Change History (Immutable Field-Level Audit Trail)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_change_history (
  id TEXT PRIMARY KEY CHECK (LENGTH(TRIM(id)) > 0),
  discovered_business_id TEXT REFERENCES discovered_businesses(id) ON DELETE CASCADE,
  business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  field_changed TEXT NOT NULL CHECK (LENGTH(TRIM(field_changed)) > 0),
  old_value TEXT,
  new_value TEXT,
  change_source TEXT NOT NULL CHECK (
    change_source IN (
      'source_connector',
      'verification_engine',
      'deduplication_engine',
      'monitoring_bot',
      'admin_review',
      'owner_update'
    )
  ),
  actor_id TEXT,
  actor_email TEXT,
  reason TEXT,
  evidence_id TEXT REFERENCES business_evidence(id) ON DELETE SET NULL,
  applied_mode TEXT NOT NULL DEFAULT 'automatic' CHECK (
    applied_mode IN ('automatic', 'admin_approved', 'flagged_conflict')
  ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (discovered_business_id IS NOT NULL OR business_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_business_change_history_discovered
  ON business_change_history (discovered_business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_change_history_business
  ON business_change_history (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_change_history_created
  ON business_change_history (created_at DESC);

-- -----------------------------------------------------------------------------
-- 7. Bot Review Queue (Human Moderation for Uncertain Matches, Conflicts, Closures)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bot_review_queue (
  id TEXT PRIMARY KEY CHECK (LENGTH(TRIM(id)) > 0),
  discovered_business_id TEXT REFERENCES discovered_businesses(id) ON DELETE CASCADE,
  business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  review_reason TEXT NOT NULL CHECK (
    review_reason IN (
      'low_confidence',
      'possible_duplicate',
      'conflicting_data',
      'suspected_relocation',
      'suspected_closure',
      'first_publication',
      'manual_escalation'
    )
  ),
  confidence_score REAL NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  duplicate_candidates_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  suggested_action TEXT NOT NULL CHECK (
    suggested_action IN (
      'approve_publish',
      'merge_duplicate',
      'keep_separate_branch',
      'update_location',
      'archive_closed',
      'reject',
      'request_verification'
    )
  ),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    review_status IN ('pending', 'in_review', 'approved', 'rejected', 'merged', 'dismissed')
  ),
  admin_decision TEXT,
  admin_note TEXT,
  decided_by TEXT,
  decided_at INTEGER CHECK (decided_at IS NULL OR decided_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  CHECK (discovered_business_id IS NOT NULL OR business_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_bot_review_queue_status_created
  ON bot_review_queue (review_status, confidence_score DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_review_queue_discovered
  ON bot_review_queue (discovered_business_id, review_status);

-- -----------------------------------------------------------------------------
-- 8. Discovery Coverage Matrix (GEOGRAPHY × CATEGORY × SOURCE)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovery_coverage_cells (
  id TEXT PRIMARY KEY CHECK (LENGTH(TRIM(id)) > 0),
  source_id TEXT NOT NULL REFERENCES discovery_sources(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (LENGTH(TRIM(state)) > 0),
  lga TEXT NOT NULL CHECK (LENGTH(TRIM(lga)) > 0),
  category TEXT NOT NULL CHECK (LENGTH(TRIM(category)) > 0),
  discovered_count INTEGER NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
  published_count INTEGER NOT NULL DEFAULT 0 CHECK (published_count >= 0),
  priority_score REAL NOT NULL DEFAULT 100 CHECK (priority_score >= 0),
  last_scanned_at INTEGER CHECK (last_scanned_at IS NULL OR last_scanned_at >= 0),
  next_scan_after INTEGER CHECK (next_scan_after IS NULL OR next_scan_after >= 0),
  scan_count INTEGER NOT NULL DEFAULT 0 CHECK (scan_count >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_coverage_cells_matrix
  ON discovery_coverage_cells (source_id, state, lga, category);

CREATE INDEX IF NOT EXISTS idx_coverage_cells_priority
  ON discovery_coverage_cells (source_id, next_scan_after ASC, priority_score DESC);

-- -----------------------------------------------------------------------------
-- 9. Discovery Bot Runtime Controls (Admin-Editable Governance Singleton)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovery_bot_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  global_paused INTEGER NOT NULL DEFAULT 0 CHECK (global_paused IN (0, 1)),
  discovery_paused INTEGER NOT NULL DEFAULT 0 CHECK (discovery_paused IN (0, 1)),
  monitoring_paused INTEGER NOT NULL DEFAULT 0 CHECK (monitoring_paused IN (0, 1)),
  daily_job_limit INTEGER NOT NULL DEFAULT 25 CHECK (daily_job_limit > 0 AND daily_job_limit <= 500),
  max_batch_size INTEGER NOT NULL DEFAULT 50 CHECK (max_batch_size > 0 AND max_batch_size <= 500),
  auto_publish_min_confidence REAL NOT NULL DEFAULT 0.85 CHECK (auto_publish_min_confidence >= 0.5 AND auto_publish_min_confidence <= 1),
  auto_publish_min_sources INTEGER NOT NULL DEFAULT 2 CHECK (auto_publish_min_sources >= 1 AND auto_publish_min_sources <= 10),
  review_min_confidence REAL NOT NULL DEFAULT 0.35 CHECK (review_min_confidence >= 0 AND review_min_confidence <= 1),
  closure_confirm_threshold INTEGER NOT NULL DEFAULT 3 CHECK (closure_confirm_threshold >= 2 AND closure_confirm_threshold <= 10),
  monitoring_default_days INTEGER NOT NULL DEFAULT 30 CHECK (monitoring_default_days >= 1 AND monitoring_default_days <= 365),
  ai_extraction_enabled INTEGER NOT NULL DEFAULT 0 CHECK (ai_extraction_enabled IN (0, 1)),
  ai_daily_budget_calls INTEGER NOT NULL DEFAULT 50 CHECK (ai_daily_budget_calls >= 0 AND ai_daily_budget_calls <= 5000),
  updated_by TEXT,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
);

INSERT OR IGNORE INTO discovery_bot_settings (
  id, global_paused, discovery_paused, monitoring_paused,
  daily_job_limit, max_batch_size, auto_publish_min_confidence,
  auto_publish_min_sources, review_min_confidence, closure_confirm_threshold,
  monitoring_default_days, ai_extraction_enabled, ai_daily_budget_calls,
  updated_at
) VALUES (
  'default', 0, 0, 0,
  25, 50, 0.85,
  2, 0.35, 3,
  30, 0, 50,
  0
);
