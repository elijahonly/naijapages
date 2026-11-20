-- =============================================================================
-- Reversible Rollback Reference for Migrations 0004 & 0005
--
-- NOTE: Do NOT place this file inside `worker/migrations/` (Wrangler executes
-- every .sql file in that folder sequentially). Run statements manually only
-- during controlled staging/local rollbacks.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- Rollback Migration 0005 tables
DROP TABLE IF EXISTS discovery_bot_settings;
DROP TABLE IF EXISTS discovery_coverage_cells;
DROP TABLE IF EXISTS bot_review_queue;
DROP TABLE IF EXISTS business_change_history;
DROP TABLE IF EXISTS business_monitoring;

-- Drop Migration 0005 indexes
DROP INDEX IF EXISTS idx_discovered_businesses_lifecycle;
DROP INDEX IF EXISTS idx_discovered_businesses_norm_phone;
DROP INDEX IF EXISTS idx_discovered_businesses_domain;
DROP INDEX IF EXISTS idx_discovered_businesses_published_link;
DROP INDEX IF EXISTS idx_businesses_origin_status;

-- SQLite 3.35+ supports DROP COLUMN when no dependent index remains:
-- ALTER TABLE discovery_sources DROP COLUMN integration_type;
-- ALTER TABLE discovery_sources DROP COLUMN health_status;
-- ALTER TABLE discovery_sources DROP COLUMN reliability_score;
-- ALTER TABLE discovery_sources DROP COLUMN consecutive_failures;
-- ALTER TABLE discovery_sources DROP COLUMN circuit_open_until;
-- ALTER TABLE discovery_sources DROP COLUMN update_frequency;
-- ALTER TABLE discovered_businesses DROP COLUMN lifecycle_status;
-- ALTER TABLE discovered_businesses DROP COLUMN published_business_id;
-- ALTER TABLE discovered_businesses DROP COLUMN corroborating_source_count;
-- ALTER TABLE discovered_businesses DROP COLUMN verification_tier;
-- ALTER TABLE discovered_businesses DROP COLUMN verified_at;
-- ALTER TABLE discovered_businesses DROP COLUMN verification_notes;
-- ALTER TABLE discovered_businesses DROP COLUMN attribution_text;
-- ALTER TABLE discovered_businesses DROP COLUMN source_licence_url;
-- ALTER TABLE discovered_businesses DROP COLUMN canonical_domain;
-- ALTER TABLE discovered_businesses DROP COLUMN normalized_phone;
-- ALTER TABLE discovery_jobs DROP COLUMN processed_count;
-- ALTER TABLE businesses DROP COLUMN origin_type;
-- ALTER TABLE businesses DROP COLUMN verification_tier;
-- ALTER TABLE businesses DROP COLUMN source_attribution;
-- ALTER TABLE businesses DROP COLUMN source_licence_url;
-- ALTER TABLE businesses DROP COLUMN discovered_business_id;

-- Rollback Migration 0004 tables (destructive to discovery staging only; never touches member `businesses`)
-- DROP TABLE IF EXISTS business_evidence;
-- DROP TABLE IF EXISTS discovered_businesses;
-- DROP TABLE IF EXISTS discovery_jobs;
-- DROP TABLE IF EXISTS discovery_sources;
