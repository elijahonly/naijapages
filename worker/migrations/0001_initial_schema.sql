-- =============================================================================
-- Migration 0001: NaijaPages Initial D1 (SQLite) Relational Schema
--
-- Covers:
--   • Better Auth core tables (user, session, account, verification)
--   • Role & moderation fields on user (role, banned, ban_reason, etc.)
--   • Directory businesses, marketplace ads, reviews, claims, reports
--   • Bundled-listing overrides, contact messages, newsletter, settings, audit log
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 1. Better Auth Core Tables + Admin / Ban Extension
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  image TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  banned INTEGER NOT NULL DEFAULT 0 CHECK (banned IN (0, 1)),
  ban_reason TEXT,
  banned_by TEXT,
  banned_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_role ON user (role);
CREATE INDEX IF NOT EXISTS idx_user_banned ON user (banned);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_user_id ON session (user_id);
CREATE INDEX IF NOT EXISTS idx_session_expires_at ON session (expires_at);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (provider_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_account_user_id ON account (user_id);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification (identifier);

-- -----------------------------------------------------------------------------
-- 2. Directory Businesses (Community Submissions)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  owner_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  state TEXT NOT NULL,
  lga TEXT NOT NULL,
  address TEXT NOT NULL,
  landmark TEXT,
  phone TEXT NOT NULL,
  secondary_phone TEXT,
  whatsapp TEXT,
  email TEXT,
  website TEXT,
  google_map_url TEXT NOT NULL,
  logo_url TEXT,
  cac_status TEXT CHECK (cac_status IN ('registered', 'pending', 'unregistered')),
  cac_number TEXT,
  year_established INTEGER CHECK (year_established IS NULL OR (year_established >= 1800 AND year_established <= 2100)),
  price_level TEXT CHECK (price_level IS NULL OR price_level IN ('₦', '₦₦', '₦₦₦', '₦₦₦₦')),
  payment_methods_json TEXT NOT NULL DEFAULT '[]',
  socials_json TEXT NOT NULL DEFAULT '{}',
  tags_json TEXT NOT NULL DEFAULT '[]',
  opening_hours TEXT,
  description TEXT,
  rating REAL NOT NULL DEFAULT 0,
  reviews_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
  is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1)),
  claimed INTEGER NOT NULL DEFAULT 0 CHECK (claimed IN (0, 1)),
  claimed_from_seed_id TEXT,
  moderation_note TEXT,
  reviewed_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_businesses_status_created ON businesses (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_businesses_owner ON businesses (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_businesses_state_status ON businesses (state, status);

-- -----------------------------------------------------------------------------
-- 3. Marketplace Ads
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  owner_name TEXT NOT NULL DEFAULT '',
  business_id TEXT REFERENCES businesses(id) ON DELETE SET NULL,
  business_name TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  is_negotiable INTEGER NOT NULL DEFAULT 0 CHECK (is_negotiable IN (0, 1)),
  condition TEXT NOT NULL CHECK (condition IN ('Brand New', 'Foreign Used (Tokunbo)', 'Nigerian Used', 'Refurbished')),
  description TEXT NOT NULL,
  image_url TEXT NOT NULL,
  additional_images_json TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL,
  lga TEXT NOT NULL,
  location_hub TEXT,
  phone TEXT NOT NULL,
  whatsapp TEXT,
  cac_number TEXT,
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  views_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'removed')),
  moderation_note TEXT,
  reviewed_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_marketplace_status_created ON marketplace_items (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_owner ON marketplace_items (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_business ON marketplace_items (business_id);

-- -----------------------------------------------------------------------------
-- 4. Reviews (one per member per business)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (business_id, author_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_business_created ON reviews (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_author ON reviews (author_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 5. Ownership Claims (one per claimant per business)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  business_name TEXT NOT NULL,
  claimant_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Owner / Founder', 'General Manager', 'Marketing & PR', 'Authorized Agent')),
  proof_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note TEXT,
  reviewed_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (business_id, claimant_id)
);

CREATE INDEX IF NOT EXISTS idx_claims_status_created ON claims (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_claims_claimant ON claims (claimant_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 6. Moderation Reports (one per reporter per target)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('business', 'ad', 'review')),
  target_id TEXT NOT NULL,
  target_title TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  reporter_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  reporter_name TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution TEXT,
  resolved_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (reporter_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_status_created ON reports (status, created_at DESC);

-- -----------------------------------------------------------------------------
-- 7. Bundled Seed Listing Overrides
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_overrides (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('business', 'marketplace')),
  listing_id TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  claimed_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (kind, listing_id)
);

-- -----------------------------------------------------------------------------
-- 8. Contact Messages & Newsletter Subscribers
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY,
  uid TEXT REFERENCES user(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_status_created ON contact_messages (status, created_at DESC);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  email TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'homepage_banner',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed')),
  subscribed_at TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- -----------------------------------------------------------------------------
-- 9. Site Settings & Admin Audit Log
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_settings (
  id TEXT PRIMARY KEY DEFAULT 'site',
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  office_hours TEXT NOT NULL DEFAULT '',
  about_story TEXT NOT NULL DEFAULT '',
  announcement_enabled INTEGER NOT NULL DEFAULT 0 CHECK (announcement_enabled IN (0, 1)),
  announcement_text TEXT NOT NULL DEFAULT '',
  ads_need_approval INTEGER NOT NULL DEFAULT 0 CHECK (ads_need_approval IN (0, 1)),
  updated_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO site_settings (
  id,
  contact_email,
  contact_phone,
  whatsapp,
  address,
  office_hours,
  about_story,
  announcement_enabled,
  announcement_text,
  ads_need_approval,
  updated_at
) VALUES (
  'site', '', '', '', '', '', '', 0, '', 0, 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  admin_email TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  summary TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
