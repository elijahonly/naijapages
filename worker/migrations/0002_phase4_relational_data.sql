-- =============================================================================
-- Migration 0002: Phase 4 Relational Entities, Favourites, Categories & Indexes
--
-- Adds:
--   • categories (normalized directory & marketplace category catalog)
--   • favourites (per-member saved businesses synced to D1)
--   • admin_records (administrator grant metadata mirroring /admins/{uid})
--   • user_bans (suspension/moderation metadata mirroring /bans/{uid})
--   • category_id foreign keys on businesses & marketplace_items
--   • Search, filtering, moderation, and relational join indexes
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 1. Categories (Directory & Marketplace)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('directory', 'marketplace')),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kind, key)
);

CREATE INDEX IF NOT EXISTS idx_categories_kind_sort ON categories (kind, is_active, sort_order);

-- Seed canonical directory categories
INSERT OR IGNORE INTO categories (id, kind, key, label, emoji, sort_order, is_active, created_at) VALUES
  ('dir_Tech', 'directory', 'Tech', 'Tech & Innovation', '💻', 1, 1, 0),
  ('dir_Food', 'directory', 'Food', 'Food & Restaurants', '🍲', 2, 1, 0),
  ('dir_Hotels', 'directory', 'Hotels', 'Hotels & Lodging', '🏨', 3, 1, 0),
  ('dir_Health', 'directory', 'Health', 'Health & Hospitals', '🏥', 4, 1, 0),
  ('dir_Finance', 'directory', 'Finance', 'Finance & Banking', '🏦', 5, 1, 0),
  ('dir_Retail', 'directory', 'Retail', 'Retail & Supermarkets', '🛍️', 6, 1, 0),
  ('dir_Auto', 'directory', 'Auto', 'Auto & Transport', '🚗', 7, 1, 0),
  ('dir_Education', 'directory', 'Education', 'Education & Schools', '🎓', 8, 1, 0),
  ('dir_Beauty', 'directory', 'Beauty', 'Beauty & Spas', '💈', 9, 1, 0),
  ('dir_Services', 'directory', 'Services', 'Professional Services', '⚖️', 10, 1, 0),
  ('dir_Artisans', 'directory', 'Artisans', 'Artisans & Repairs', '🔧', 11, 1, 0);

-- Seed canonical marketplace categories
INSERT OR IGNORE INTO categories (id, kind, key, label, emoji, sort_order, is_active, created_at) VALUES
  ('mkt_Vehicles', 'marketplace', 'Vehicles', 'Vehicles & Cars', '🚗', 1, 1, 0),
  ('mkt_Phones & Tablets', 'marketplace', 'Phones & Tablets', 'Phones & Tablets', '📱', 2, 1, 0),
  ('mkt_Electronics & Appliances', 'marketplace', 'Electronics & Appliances', 'Electronics & Solar', '⚡', 3, 1, 0),
  ('mkt_Fashion & Beauty', 'marketplace', 'Fashion & Beauty', 'Fashion & Beauty', '👗', 4, 1, 0),
  ('mkt_Home, Furniture & Living', 'marketplace', 'Home, Furniture & Living', 'Home & Furniture', '🛋️', 5, 1, 0),
  ('mkt_Real Estate', 'marketplace', 'Real Estate', 'Property & Land', '🏠', 6, 1, 0),
  ('mkt_Agriculture & Food', 'marketplace', 'Agriculture & Food', 'Agro & Foodstuffs', '🌾', 7, 1, 0),
  ('mkt_Commercial & Industrial', 'marketplace', 'Commercial & Industrial', 'Industrial & Tools', '🏗️', 8, 1, 0),
  ('mkt_Services', 'marketplace', 'Services', 'Pro Services', '💼', 9, 1, 0);

-- Link businesses and marketplace_items to categories via optional FK
ALTER TABLE businesses ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE marketplace_items ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL;

UPDATE businesses
SET category_id = 'dir_' || category
WHERE category_id IS NULL AND EXISTS (SELECT 1 FROM categories c WHERE c.id = 'dir_' || businesses.category);

UPDATE marketplace_items
SET category_id = 'mkt_' || category
WHERE category_id IS NULL AND EXISTS (SELECT 1 FROM categories c WHERE c.id = 'mkt_' || marketplace_items.category);

-- -----------------------------------------------------------------------------
-- 2. Member Favourites / Saved Businesses
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS favourites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, business_id)
);

CREATE INDEX IF NOT EXISTS idx_favourites_user_created ON favourites (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_favourites_business ON favourites (business_id);

-- -----------------------------------------------------------------------------
-- 3. Administrator & Ban / Suspension Records (with Foreign Keys)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_records (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  email TEXT NOT NULL DEFAULT '',
  added_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  added_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_records_added_at ON admin_records (added_at DESC);

INSERT OR IGNORE INTO admin_records (user_id, email, added_by, added_at)
SELECT id, email, NULL, created_at FROM user WHERE role = 'admin';

CREATE TABLE IF NOT EXISTS user_bans (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  email TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  banned_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  banned_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_bans_banned_at ON user_bans (banned_at DESC);

INSERT OR IGNORE INTO user_bans (user_id, email, name, reason, banned_by, banned_at)
SELECT id, email, name, COALESCE(ban_reason, 'Account suspended'), banned_by, COALESCE(banned_at, updated_at)
FROM user WHERE banned = 1;

-- -----------------------------------------------------------------------------
-- 4. Additional Search, Filtering & Moderation Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_businesses_cat_state_status ON businesses (category, state, status);
CREATE INDEX IF NOT EXISTS idx_businesses_category_id ON businesses (category_id);
CREATE INDEX IF NOT EXISTS idx_businesses_rating_status ON businesses (status, rating DESC, reviews_count DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_cat_state_status ON marketplace_items (category, state, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_category_id ON marketplace_items (category_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_price_status ON marketplace_items (status, price ASC);

CREATE INDEX IF NOT EXISTS idx_claims_business ON claims (business_id);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_admin_created ON audit_log (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log (target_type, target_id);
