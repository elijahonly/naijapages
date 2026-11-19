-- =============================================================================
-- Migration 0003: Phase 5 Cloudflare R2 Media Metadata & Image/Attachment Columns
--
-- Adds:
--   • media_objects (ownership, visibility, MIME/size metadata & entity links)
--   • businesses.cover_image_url & businesses.gallery_json
--   • claims.proof_attachment_url (private verification evidence stored in R2)
--   • Indexes for owner & entity lookups and visibility checks
-- =============================================================================

PRAGMA foreign_keys = ON;

-- Businesses: cover photo and multi-image gallery
ALTER TABLE businesses ADD COLUMN cover_image_url TEXT;
ALTER TABLE businesses ADD COLUMN gallery_json TEXT NOT NULL DEFAULT '[]';

-- Claims: optional private proof file attachment URL (/api/media/private/...)
ALTER TABLE claims ADD COLUMN proof_attachment_url TEXT;

-- Authoritative media ownership and access-control metadata for R2 objects
CREATE TABLE IF NOT EXISTS media_objects (
  key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (
    purpose IN (
      'avatar',
      'business_logo',
      'business_photo',
      'business_gallery',
      'marketplace_image',
      'claim_proof',
      'general'
    )
  ),
  entity_type TEXT CHECK (entity_type IN ('user', 'business', 'marketplace_item', 'claim')),
  entity_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT,
  original_filename TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_owner_created ON media_objects (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_entity ON media_objects (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_media_visibility ON media_objects (visibility, purpose);
