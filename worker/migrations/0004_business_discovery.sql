-- =============================================================================
-- Migration 0004: Phase 1 Business Discovery Database Foundation
--
-- Adds a strictly isolated staging, provenance, and evidence layer for
-- nationwide Nigerian business discovery without modifying or weakening
-- constraints on member-submitted `businesses` or `user` tables:
--   • discovery_sources     (authorised external sources & licensing metadata)
--   • discovery_jobs        (scheduled/queued discovery execution records)
--   • discovered_businesses (nullable-contact candidate staging records)
--   • business_evidence     (append-only traceable evidence per candidate)
--   • SQLite-compatible indexes and integrity constraints
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 1. Discovery Sources (Authorised Data Sources & Licensing Governance)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovery_sources (
  id TEXT PRIMARY KEY CHECK (LENGTH(TRIM(id)) > 0),
  name TEXT NOT NULL CHECK (LENGTH(TRIM(name)) > 0),
  source_type TEXT NOT NULL CHECK (
    source_type IN (
      'open_data',
      'public_registry',
      'map_directory',
      'government_portal',
      'partner_api',
      'web_directory',
      'other'
    )
  ),
  base_url TEXT NOT NULL CHECK (LENGTH(TRIM(base_url)) > 0),
  description TEXT,
  licence_name TEXT NOT NULL CHECK (LENGTH(TRIM(licence_name)) > 0),
  licence_url TEXT,
  attribution_text TEXT,
  permitted_usage TEXT,
  permission_status TEXT NOT NULL DEFAULT 'pending_review' CHECK (
    permission_status IN (
      'pending_review',
      'approved',
      'restricted',
      'rejected',
      'revoked'
    )
  ),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 30 CHECK (rate_limit_per_minute > 0),
  last_successful_sync INTEGER CHECK (last_successful_sync IS NULL OR last_successful_sync >= 0),
  last_failed_sync INTEGER CHECK (last_failed_sync IS NULL OR last_failed_sync >= 0),
  last_error TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  -- Prevent unapproved sources from ever being enabled at the database layer.
  CHECK (enabled = 0 OR permission_status = 'approved')
);

CREATE INDEX IF NOT EXISTS idx_discovery_sources_status_enabled
  ON discovery_sources (permission_status, enabled);

CREATE INDEX IF NOT EXISTS idx_discovery_sources_type
  ON discovery_sources (source_type);

-- -----------------------------------------------------------------------------
-- 2. Discovery Jobs (Job Queue Metadata, Coverage Tracking & Idempotency)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovery_jobs (
  id TEXT PRIMARY KEY CHECK (LENGTH(TRIM(id)) > 0),
  source_id TEXT NOT NULL REFERENCES discovery_sources(id) ON DELETE RESTRICT,
  job_type TEXT NOT NULL CHECK (
    job_type IN (
      'state_sweep',
      'lga_sweep',
      'category_sweep',
      'targeted_lookup',
      'refresh',
      'reverification'
    )
  ),
  country TEXT NOT NULL DEFAULT 'Nigeria' CHECK (LENGTH(TRIM(country)) > 0),
  state TEXT,
  lga TEXT,
  town TEXT,
  category TEXT,
  geographic_filter_json TEXT NOT NULL DEFAULT '{}',
  search_parameters_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN (
      'queued',
      'running',
      'completed',
      'partially_completed',
      'failed',
      'cancelled'
    )
  ),
  priority INTEGER NOT NULL DEFAULT 100 CHECK (priority >= 0 AND priority <= 1000),
  idempotency_key TEXT CHECK (idempotency_key IS NULL OR LENGTH(TRIM(idempotency_key)) > 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  discovered_count INTEGER NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
  accepted_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  error_message TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  started_at INTEGER CHECK (started_at IS NULL OR started_at >= 0),
  completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);

-- Enforce idempotency key uniqueness whenever a key is supplied.
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_jobs_idempotency_key
  ON discovery_jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Next-job selection (lowest priority number first, then FIFO by created_at).
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_next_queue
  ON discovery_jobs (status, priority ASC, created_at ASC);

-- Job status and creation date dashboards / history queries.
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_status_created
  ON discovery_jobs (status, created_at DESC);

-- Source-scoped job history and concurrency checks.
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_source_status
  ON discovery_jobs (source_id, status, created_at DESC);

-- Geographic & category coverage inspection.
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_geo_category
  ON discovery_jobs (state, lga, category);

-- -----------------------------------------------------------------------------
-- 3. Discovered Businesses (Staging Candidates — Incomplete Data Allowed)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovered_businesses (
  id TEXT PRIMARY KEY CHECK (LENGTH(TRIM(id)) > 0),
  source_id TEXT NOT NULL REFERENCES discovery_sources(id) ON DELETE RESTRICT,
  source_record_id TEXT NOT NULL CHECK (LENGTH(TRIM(source_record_id)) > 0),
  source_record_type TEXT,
  source_url TEXT,
  name TEXT NOT NULL CHECK (LENGTH(TRIM(name)) > 0),
  normalized_name TEXT NOT NULL CHECK (LENGTH(TRIM(normalized_name)) > 0),
  category TEXT,
  subcategory TEXT,
  country TEXT NOT NULL DEFAULT 'Nigeria' CHECK (LENGTH(TRIM(country)) > 0),
  state TEXT,
  lga TEXT,
  city TEXT,
  address TEXT,
  phone TEXT,
  secondary_phone TEXT,
  email TEXT,
  website TEXT,
  latitude REAL CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  longitude REAL CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
  opening_hours TEXT,
  description TEXT,
  raw_source_data_json TEXT NOT NULL DEFAULT '{}',
  normalized_data_json TEXT NOT NULL DEFAULT '{}',
  identity_hash TEXT,
  confidence_score REAL NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (
    verification_status IN (
      'unverified',
      'source_corroborated',
      'owner_pending',
      'owner_verified',
      'disputed'
    )
  ),
  review_status TEXT NOT NULL DEFAULT 'discovered' CHECK (
    review_status IN (
      'discovered',
      'needs_review',
      'approved',
      'rejected',
      'duplicate',
      'archived'
    )
  ),
  first_seen_at INTEGER NOT NULL CHECK (first_seen_at >= 0),
  last_seen_at INTEGER NOT NULL CHECK (last_seen_at >= 0 AND last_seen_at >= first_seen_at),
  last_checked_at INTEGER CHECK (last_checked_at IS NULL OR last_checked_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  -- Coordinates must either both be null or both be present.
  CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL))
);

-- Prevent duplicate imports of the same external record from the same source.
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovered_businesses_source_record
  ON discovered_businesses (source_id, source_record_id);

-- Candidate review queue & confidence ordering.
CREATE INDEX IF NOT EXISTS idx_discovered_businesses_review_status
  ON discovered_businesses (review_status, confidence_score DESC, updated_at DESC);

-- Separation of owner/source verification status from review workflow.
CREATE INDEX IF NOT EXISTS idx_discovered_businesses_verification_status
  ON discovered_businesses (verification_status, review_status);

-- State & LGA coverage and geographic filtering.
CREATE INDEX IF NOT EXISTS idx_discovered_businesses_state_lga_status
  ON discovered_businesses (state, lga, review_status);

-- Coordinate bounding-box filtering when coordinates exist.
CREATE INDEX IF NOT EXISTS idx_discovered_businesses_geo_coords
  ON discovered_businesses (latitude, longitude);

-- Category & state coverage reporting.
CREATE INDEX IF NOT EXISTS idx_discovered_businesses_category_state
  ON discovered_businesses (category, state, review_status);

-- Identity matching & deduplication lookups.
CREATE INDEX IF NOT EXISTS idx_discovered_businesses_identity_hash
  ON discovered_businesses (identity_hash);

CREATE INDEX IF NOT EXISTS idx_discovered_businesses_normalized_name_state
  ON discovered_businesses (normalized_name, state);

-- -----------------------------------------------------------------------------
-- 4. Business Evidence (Append-Only Traceable Field & Source Evidence)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_evidence (
  id TEXT PRIMARY KEY CHECK (LENGTH(TRIM(id)) > 0),
  discovered_business_id TEXT NOT NULL REFERENCES discovered_businesses(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES discovery_sources(id) ON DELETE RESTRICT,
  evidence_type TEXT NOT NULL CHECK (
    evidence_type IN (
      'source_record',
      'field_extraction',
      'corroboration',
      'geocode',
      'website_check',
      'registry_match',
      'manual_review',
      'other'
    )
  ),
  field_name TEXT NOT NULL CHECK (LENGTH(TRIM(field_name)) > 0),
  evidence_value TEXT,
  source_url TEXT,
  source_record_id TEXT,
  source_timestamp INTEGER CHECK (source_timestamp IS NULL OR source_timestamp >= 0),
  collected_at INTEGER NOT NULL CHECK (collected_at >= 0),
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  licence_reference TEXT,
  attribution_text TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
);

-- Lookup full evidence timeline for a candidate business.
CREATE INDEX IF NOT EXISTS idx_business_evidence_candidate_collected
  ON business_evidence (discovered_business_id, collected_at DESC);

-- Lookup field-level evidence history for a candidate without overwriting older rows.
CREATE INDEX IF NOT EXISTS idx_business_evidence_candidate_field
  ON business_evidence (discovered_business_id, field_name, collected_at DESC);

-- Trace evidence back to a source and external record identifier.
CREATE INDEX IF NOT EXISTS idx_business_evidence_source_record
  ON business_evidence (source_id, source_record_id);
