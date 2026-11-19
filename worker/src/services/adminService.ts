import {
  cleanMultiline,
  cleanText,
  LIMITS,
  parseJsonArray,
  validateAdminBusinessEdit,
  validateSettingsInput,
  ValidationError,
} from '../lib/validation';
import type { AuthSessionUser, Bindings } from '../types';
import { recalculateBusinessRatingStmt } from './directoryService';
import { cleanupMediaUrlsForActor } from './mediaService';
import {
  mapBusinessRow,
  mapClaimRow,
  mapMarketplaceRow,
  mapOverrideRow,
  mapReportRow,
  mapReviewRow,
  mapSettingsRow,
  type BusinessDbRow,
  type ClaimDbRow,
  type MarketplaceDbRow,
  type OverrideDbRow,
  type ReportDbRow,
  type ReviewDbRow,
  type SettingsDbRow,
} from './mappers';

function auditStmt(
  db: D1Database,
  admin: AuthSessionUser,
  entry: { action: string; targetType?: string; targetId?: string; summary?: string },
  now: number,
) {
  return db
    .prepare(
      `INSERT INTO audit_log (id, admin_id, admin_email, action, target_type, target_id, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      admin.id,
      cleanText(admin.email, 150),
      cleanText(entry.action, 60),
      entry.targetType ? cleanText(entry.targetType, 40) : null,
      entry.targetId ? cleanText(entry.targetId, 300) : null,
      entry.summary ? cleanText(entry.summary, 500) : null,
      now,
    );
}

// ---------------------------------------------------------------------------
// Admin Dashboard & Queues
// ---------------------------------------------------------------------------

export async function getAdminOverview(db: D1Database) {
  const [
    usersCount,
    bizCount,
    adCount,
    reviewsCount,
    subsCount,
    pendingBiz,
    pendingAds,
    openReports,
    pendingClaims,
    newMsgCount,
    overridesRes,
    recentAudit,
  ] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS count FROM user').first<{ count: number }>(),
    db
      .prepare("SELECT COUNT(*) AS count FROM businesses WHERE status = 'approved'")
      .first<{ count: number }>(),
    db
      .prepare("SELECT COUNT(*) AS count FROM marketplace_items WHERE status = 'active'")
      .first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) AS count FROM reviews').first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) AS count FROM newsletter_subscribers').first<{ count: number }>(),
    db
      .prepare("SELECT * FROM businesses WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100")
      .all<BusinessDbRow>(),
    db
      .prepare(
        `SELECT m.*, b.is_verified AS linked_business_verified
         FROM marketplace_items m
         LEFT JOIN businesses b ON b.id = m.business_id AND b.status = 'approved'
         WHERE m.status = 'pending'
         ORDER BY m.created_at DESC LIMIT 100`,
      )
      .all<MarketplaceDbRow>(),
    db
      .prepare("SELECT * FROM reports WHERE status = 'open' ORDER BY created_at DESC LIMIT 100")
      .all<ReportDbRow>(),
    db
      .prepare("SELECT * FROM claims WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100")
      .all<ClaimDbRow>(),
    db
      .prepare("SELECT COUNT(*) AS count FROM contact_messages WHERE status = 'new'")
      .first<{ count: number }>(),
    db.prepare('SELECT * FROM listing_overrides').all<OverrideDbRow>(),
    db
      .prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 6')
      .all<{
        id: string;
        admin_email: string;
        action: string;
        target_type: string | null;
        target_id: string | null;
        summary: string | null;
        created_at: number;
      }>(),
  ]);

  return {
    stats: {
      users: Number(usersCount?.count ?? 0),
      businesses: Number(bizCount?.count ?? 0),
      ads: Number(adCount?.count ?? 0),
      reviews: Number(reviewsCount?.count ?? 0),
      subscribers: Number(subsCount?.count ?? 0),
    },
    queues: {
      pendingBusinesses: pendingBiz.results.map(mapBusinessRow),
      pendingAds: pendingAds.results.map(mapMarketplaceRow),
      openReports: openReports.results.map(mapReportRow),
      pendingClaims: pendingClaims.results.map(mapClaimRow),
      newMessageCount: Number(newMsgCount?.count ?? 0),
      overrides: overridesRes.results.map(mapOverrideRow),
    },
    recentAudit: recentAudit.results.map((r) => ({
      id: r.id,
      adminEmail: cleanText(r.admin_email, 150),
      action: cleanText(r.action, 60),
      targetType: r.target_type ? cleanText(r.target_type, 40) : undefined,
      targetId: r.target_id ? cleanText(r.target_id, 300) : undefined,
      summary: r.summary ? cleanText(r.summary, 500) : undefined,
      createdAt: Number(r.created_at) || undefined,
    })),
  };
}

// ---------------------------------------------------------------------------
// Admin List Queries
// ---------------------------------------------------------------------------

export async function listAdminBusinesses(db: D1Database, limitCount = 400) {
  const safeLimit = Math.min(500, Math.max(1, Math.trunc(limitCount)));
  const res = await db
    .prepare('SELECT * FROM businesses ORDER BY created_at DESC LIMIT ?')
    .bind(safeLimit)
    .all<BusinessDbRow>();
  return res.results.map(mapBusinessRow);
}

export async function listAdminAds(db: D1Database, limitCount = 400) {
  const safeLimit = Math.min(500, Math.max(1, Math.trunc(limitCount)));
  const res = await db
    .prepare(
      `SELECT m.*, b.is_verified AS linked_business_verified
       FROM marketplace_items m
       LEFT JOIN businesses b ON b.id = m.business_id AND b.status = 'approved'
       ORDER BY m.created_at DESC
       LIMIT ?`,
    )
    .bind(safeLimit)
    .all<MarketplaceDbRow>();
  return res.results.map(mapMarketplaceRow);
}

export async function listAdminClaims(db: D1Database, limitCount = 400) {
  const safeLimit = Math.min(500, Math.max(1, Math.trunc(limitCount)));
  const res = await db
    .prepare('SELECT * FROM claims ORDER BY created_at DESC LIMIT ?')
    .bind(safeLimit)
    .all<ClaimDbRow>();
  return res.results.map(mapClaimRow);
}

export async function listAdminReports(db: D1Database, limitCount = 400) {
  const safeLimit = Math.min(500, Math.max(1, Math.trunc(limitCount)));
  const res = await db
    .prepare('SELECT * FROM reports ORDER BY created_at DESC LIMIT ?')
    .bind(safeLimit)
    .all<ReportDbRow>();
  return res.results.map(mapReportRow);
}

export async function listAdminReviews(db: D1Database, limitCount = 400) {
  const safeLimit = Math.min(500, Math.max(1, Math.trunc(limitCount)));
  const res = await db
    .prepare(
      `SELECT r.*, b.name AS business_name
       FROM reviews r
       LEFT JOIN businesses b ON b.id = r.business_id
       ORDER BY r.created_at DESC
       LIMIT ?`,
    )
    .bind(safeLimit)
    .all<ReviewDbRow & { business_name?: string | null }>();
  return res.results.map((r) => ({
    ...mapReviewRow(r),
    businessName: r.business_name ? cleanText(r.business_name, LIMITS.name) : undefined,
  }));
}

export async function listAdminUsers(db: D1Database, limitCount = 400) {
  const safeLimit = Math.min(500, Math.max(1, Math.trunc(limitCount)));
  const [usersRes, bansRes, adminsRes] = await Promise.all([
    db
      .prepare('SELECT id, email, name, role, banned, ban_reason, banned_at, created_at FROM user ORDER BY created_at DESC LIMIT ?')
      .bind(safeLimit)
      .all<{
        id: string;
        email: string;
        name: string;
        role: string;
        banned: number;
        ban_reason: string | null;
        banned_at: number | null;
        created_at: number;
      }>(),
    db
      .prepare('SELECT user_id, reason, email, name, banned_by, banned_at FROM user_bans ORDER BY banned_at DESC')
      .all<{
        user_id: string;
        reason: string;
        email: string;
        name: string;
        banned_by: string | null;
        banned_at: number;
      }>(),
    db
      .prepare('SELECT user_id, email, added_by, added_at FROM admin_records ORDER BY added_at DESC')
      .all<{ user_id: string; email: string; added_by: string | null; added_at: number }>(),
  ]);

  const users = usersRes.results.map((u) => ({
    id: u.id,
    email: cleanText(u.email, 150),
    displayName: cleanText(u.name, 100),
    createdAt: Number(u.created_at) || undefined,
  }));

  const banMap = new Map<
    string,
    { id: string; reason?: string; email?: string; name?: string; bannedAt?: number; bannedBy?: string }
  >();
  for (const b of bansRes.results) {
    banMap.set(b.user_id, {
      id: b.user_id,
      reason: cleanText(b.reason, 500) || undefined,
      email: cleanText(b.email, 150) || undefined,
      name: cleanText(b.name, 100) || undefined,
      bannedAt: Number(b.banned_at) || undefined,
      bannedBy: b.banned_by || undefined,
    });
  }
  for (const u of usersRes.results) {
    if (u.banned === 1 && !banMap.has(u.id)) {
      banMap.set(u.id, {
        id: u.id,
        reason: u.ban_reason ? cleanText(u.ban_reason, 500) : undefined,
        email: cleanText(u.email, 150),
        name: cleanText(u.name, 100),
        bannedAt: u.banned_at ? Number(u.banned_at) : undefined,
      });
    }
  }

  const adminMap = new Map<string, { id: string; email?: string; addedAt?: number }>();
  for (const a of adminsRes.results) {
    adminMap.set(a.user_id, {
      id: a.user_id,
      email: cleanText(a.email, 150) || undefined,
      addedAt: Number(a.added_at) || undefined,
    });
  }
  for (const u of usersRes.results) {
    if (u.role === 'admin' && !adminMap.has(u.id)) {
      adminMap.set(u.id, {
        id: u.id,
        email: cleanText(u.email, 150) || undefined,
        addedAt: Number(u.created_at) || undefined,
      });
    }
  }

  return {
    users,
    bans: Array.from(banMap.values()),
    admins: Array.from(adminMap.values()),
  };
}

export async function listAdminMessages(db: D1Database, limitCount = 400) {
  const safeLimit = Math.min(500, Math.max(1, Math.trunc(limitCount)));
  const res = await db
    .prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT ?')
    .bind(safeLimit)
    .all<{
      id: string;
      uid: string | null;
      name: string;
      email: string;
      subject: string;
      message: string;
      status: string;
      created_at: number;
    }>();
  return res.results.map((m) => ({
    id: m.id,
    name: cleanText(m.name, 100),
    email: cleanText(m.email, 150),
    subject: cleanText(m.subject, 200),
    message: cleanMultiline(m.message, LIMITS.contactMessage),
    status: (m.status === 'read' || m.status === 'archived' ? m.status : 'new') as
      | 'new'
      | 'read'
      | 'archived',
    createdAt: Number(m.created_at) || undefined,
    uid: m.uid || undefined,
  }));
}

export async function listAdminSubscribers(db: D1Database, limitCount = 400) {
  const safeLimit = Math.min(500, Math.max(1, Math.trunc(limitCount)));
  const res = await db
    .prepare('SELECT email, source, status, subscribed_at, created_at FROM newsletter_subscribers ORDER BY created_at DESC LIMIT ?')
    .bind(safeLimit)
    .all<{
      email: string;
      source: string;
      status: string;
      subscribed_at: string;
      created_at: number;
    }>();
  return res.results.map((s) => ({
    id: s.email,
    email: cleanText(s.email, 150),
    subscribedAt: Number(s.created_at) || Date.parse(s.subscribed_at) || undefined,
    source: cleanText(s.source, 60) || undefined,
  }));
}

export async function listAdminAuditLog(db: D1Database, limitCount = 200) {
  const safeLimit = Math.min(500, Math.max(1, Math.trunc(limitCount)));
  const res = await db
    .prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?')
    .bind(safeLimit)
    .all<{
      id: string;
      admin_email: string;
      action: string;
      target_type: string | null;
      target_id: string | null;
      summary: string | null;
      created_at: number;
    }>();
  return res.results.map((r) => ({
    id: r.id,
    adminEmail: cleanText(r.admin_email, 150),
    action: cleanText(r.action, 60),
    targetType: r.target_type ? cleanText(r.target_type, 40) : undefined,
    targetId: r.target_id ? cleanText(r.target_id, 300) : undefined,
    summary: r.summary ? cleanText(r.summary, 500) : undefined,
    createdAt: Number(r.created_at) || undefined,
  }));
}

export async function getSiteSettings(db: D1Database) {
  const row = await db
    .prepare("SELECT * FROM site_settings WHERE id = 'site'")
    .first<SettingsDbRow>();
  return mapSettingsRow(row);
}

// ---------------------------------------------------------------------------
// Business Moderation Mutations
// ---------------------------------------------------------------------------

async function getBusinessBasic(db: D1Database, id: string) {
  const row = await db
    .prepare('SELECT id, name, category, state, lga, address FROM businesses WHERE id = ?')
    .bind(id)
    .first<{
      id: string;
      name: string;
      category: string;
      state: string;
      lga: string;
      address: string;
    }>();
  if (!row) throw new ValidationError('Business listing was not found.', 404, 'NOT_FOUND');
  return row;
}

export async function approveBusiness(
  db: D1Database,
  admin: AuthSessionUser,
  id: string,
  verify: boolean,
) {
  const biz = await getBusinessBasic(db, id);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE businesses
         SET status = 'approved',
             is_verified = CASE WHEN ? = 1 THEN 1 ELSE is_verified END,
             moderation_note = NULL,
             reviewed_by = ?,
             reviewed_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(verify ? 1 : 0, admin.id, now, now, id),
    auditStmt(
      db,
      admin,
      {
        action: verify ? 'business.approve_verify' : 'business.approve',
        targetType: 'business',
        targetId: id,
        summary: biz.name,
      },
      now,
    ),
  ]);
}

export async function rejectBusiness(
  db: D1Database,
  admin: AuthSessionUser,
  id: string,
  note: string,
) {
  const cleanNote = cleanText(note, 500);
  if (!cleanNote) throw new ValidationError('Please provide a rejection note.');
  const biz = await getBusinessBasic(db, id);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE businesses
         SET status = 'rejected', moderation_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(cleanNote, admin.id, now, now, id),
    auditStmt(
      db,
      admin,
      {
        action: 'business.reject',
        targetType: 'business',
        targetId: id,
        summary: `${biz.name}: ${cleanNote}`,
      },
      now,
    ),
  ]);
}

export async function removeBusiness(
  db: D1Database,
  admin: AuthSessionUser,
  id: string,
  note: string,
) {
  const cleanNote = cleanText(note, 500);
  if (!cleanNote) throw new ValidationError('Please provide a reason for removal.');
  const biz = await getBusinessBasic(db, id);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE businesses
         SET status = 'removed', moderation_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(cleanNote, admin.id, now, now, id),
    auditStmt(
      db,
      admin,
      {
        action: 'business.remove',
        targetType: 'business',
        targetId: id,
        summary: `${biz.name}: ${cleanNote}`,
      },
      now,
    ),
  ]);
}

export async function restoreBusiness(db: D1Database, admin: AuthSessionUser, id: string) {
  const biz = await getBusinessBasic(db, id);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE businesses
         SET status = 'approved', moderation_note = NULL, reviewed_by = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(admin.id, now, now, id),
    auditStmt(
      db,
      admin,
      { action: 'business.restore', targetType: 'business', targetId: id, summary: biz.name },
      now,
    ),
  ]);
}

export async function setBusinessVerified(
  db: D1Database,
  admin: AuthSessionUser,
  id: string,
  verified: boolean,
) {
  const biz = await getBusinessBasic(db, id);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE businesses
         SET is_verified = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(verified ? 1 : 0, admin.id, now, now, id),
    auditStmt(
      db,
      admin,
      {
        action: verified ? 'business.verify' : 'business.unverify',
        targetType: 'business',
        targetId: id,
        summary: biz.name,
      },
      now,
    ),
  ]);
}

export async function editBusinessAsAdmin(
  db: D1Database,
  admin: AuthSessionUser,
  id: string,
  rawEdit: Record<string, unknown>,
) {
  const biz = await getBusinessBasic(db, id);
  const clean = validateAdminBusinessEdit(rawEdit, biz);
  const now = Date.now();
  const categoryId = `dir_${clean.category}`;

  await db.batch([
    db
      .prepare(
        `UPDATE businesses
         SET name = ?, category = ?,
             category_id = CASE WHEN EXISTS (SELECT 1 FROM categories WHERE id = ?) THEN ? ELSE category_id END,
             state = ?, lga = ?, address = ?, phone = ?,
             whatsapp = ?, email = ?, website = ?, opening_hours = ?, description = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        clean.name,
        clean.category,
        categoryId,
        categoryId,
        clean.state,
        clean.lga,
        clean.address,
        clean.phone,
        clean.whatsapp ?? null,
        clean.email ?? null,
        clean.website ?? null,
        clean.openingHours ?? null,
        clean.description ?? null,
        now,
        id,
      ),
    auditStmt(
      db,
      admin,
      { action: 'business.edit', targetType: 'business', targetId: id, summary: clean.name },
      now,
    ),
  ]);
}

export async function deleteBusinessForever(
  db: D1Database,
  admin: AuthSessionUser,
  id: string,
  mediaEnv?: Pick<Bindings, 'DB' | 'MEDIA_BUCKET' | 'R2_PUBLIC_BASE_URL'>,
) {
  const biz = await db
    .prepare('SELECT id, name, logo_url, cover_image_url, gallery_json FROM businesses WHERE id = ?')
    .bind(id)
    .first<{
      id: string;
      name: string;
      logo_url: string | null;
      cover_image_url: string | null;
      gallery_json: string | null;
    }>();
  if (!biz) throw new ValidationError('Business listing was not found.', 404, 'NOT_FOUND');

  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM businesses WHERE id = ?').bind(id),
    auditStmt(
      db,
      admin,
      { action: 'business.delete', targetType: 'business', targetId: id, summary: biz.name },
      now,
    ),
  ]);

  if (mediaEnv?.MEDIA_BUCKET) {
    await cleanupMediaUrlsForActor(mediaEnv, admin, [
      biz.logo_url,
      biz.cover_image_url,
      ...parseJsonArray(biz.gallery_json),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Marketplace Ad Moderation Mutations
// ---------------------------------------------------------------------------

async function getAdBasic(db: D1Database, id: string) {
  const row = await db
    .prepare('SELECT id, title FROM marketplace_items WHERE id = ?')
    .bind(id)
    .first<{ id: string; title: string }>();
  if (!row) throw new ValidationError('Marketplace ad was not found.', 404, 'NOT_FOUND');
  return row;
}

export async function approveAd(db: D1Database, admin: AuthSessionUser, id: string) {
  const ad = await getAdBasic(db, id);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE marketplace_items
         SET status = 'active', moderation_note = NULL, reviewed_by = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(admin.id, now, now, id),
    auditStmt(
      db,
      admin,
      { action: 'ad.approve', targetType: 'ad', targetId: id, summary: ad.title },
      now,
    ),
  ]);
}

export async function removeAd(
  db: D1Database,
  admin: AuthSessionUser,
  id: string,
  note: string,
) {
  const cleanNote = cleanText(note, 500);
  if (!cleanNote) throw new ValidationError('Please provide a reason for removal.');
  const ad = await getAdBasic(db, id);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE marketplace_items
         SET status = 'removed', moderation_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(cleanNote, admin.id, now, now, id),
    auditStmt(
      db,
      admin,
      {
        action: 'ad.remove',
        targetType: 'ad',
        targetId: id,
        summary: `${ad.title}: ${cleanNote}`,
      },
      now,
    ),
  ]);
}

export async function restoreAd(db: D1Database, admin: AuthSessionUser, id: string) {
  const ad = await getAdBasic(db, id);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE marketplace_items
         SET status = 'active', moderation_note = NULL, reviewed_by = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(admin.id, now, now, id),
    auditStmt(
      db,
      admin,
      { action: 'ad.restore', targetType: 'ad', targetId: id, summary: ad.title },
      now,
    ),
  ]);
}

export async function deleteAdForever(
  db: D1Database,
  admin: AuthSessionUser,
  id: string,
  mediaEnv?: Pick<Bindings, 'DB' | 'MEDIA_BUCKET' | 'R2_PUBLIC_BASE_URL'>,
) {
  const ad = await db
    .prepare('SELECT id, title, image_url, additional_images_json FROM marketplace_items WHERE id = ?')
    .bind(id)
    .first<{
      id: string;
      title: string;
      image_url: string | null;
      additional_images_json: string | null;
    }>();
  if (!ad) throw new ValidationError('Marketplace ad was not found.', 404, 'NOT_FOUND');

  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM marketplace_items WHERE id = ?').bind(id),
    auditStmt(
      db,
      admin,
      { action: 'ad.delete', targetType: 'ad', targetId: id, summary: ad.title },
      now,
    ),
  ]);

  if (mediaEnv?.MEDIA_BUCKET) {
    await cleanupMediaUrlsForActor(mediaEnv, admin, [
      ad.image_url,
      ...parseJsonArray(ad.additional_images_json),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Built-in Overrides, Reviews, Reports, Claims
// ---------------------------------------------------------------------------

export async function setSeedHidden(
  db: D1Database,
  admin: AuthSessionUser,
  kind: 'business' | 'marketplace',
  listingId: string,
  title: string,
  hidden: boolean,
) {
  const cleanId = cleanText(listingId, 160);
  if (!cleanId) throw new ValidationError('Missing listing identifier.');
  const docId = `${kind}_${cleanId}`;
  const now = Date.now();

  const existing = await db
    .prepare('SELECT verified, claimed_by FROM listing_overrides WHERE id = ?')
    .bind(docId)
    .first<{ verified: number; claimed_by: string | null }>();

  const keep = !hidden && Boolean(existing?.verified === 1 || existing?.claimed_by);
  const overrideStmt =
    hidden || keep
      ? db
          .prepare(
            `INSERT INTO listing_overrides (id, kind, listing_id, hidden, verified, claimed_by, updated_by, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               hidden = excluded.hidden,
               updated_by = excluded.updated_by,
               updated_at = excluded.updated_at`,
          )
          .bind(
            docId,
            kind,
            cleanId,
            hidden ? 1 : 0,
            existing?.verified === 1 ? 1 : 0,
            existing?.claimed_by ?? null,
            admin.id,
            now,
          )
      : db.prepare('DELETE FROM listing_overrides WHERE id = ?').bind(docId);

  await db.batch([
    overrideStmt,
    auditStmt(
      db,
      admin,
      {
        action: hidden ? `${kind}.hide_builtin` : `${kind}.restore_builtin`,
        targetType: kind === 'business' ? 'business' : 'ad',
        targetId: cleanId,
        summary: cleanText(title, 150) || cleanId,
      },
      now,
    ),
  ]);
}

export async function deleteReviewAsAdmin(
  db: D1Database,
  admin: AuthSessionUser,
  reviewId: string,
) {
  const r = await db
    .prepare('SELECT id, business_id, author_name FROM reviews WHERE id = ?')
    .bind(reviewId)
    .first<{ id: string; business_id: string; author_name: string }>();
  if (!r) throw new ValidationError('Review was not found.', 404, 'NOT_FOUND');

  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM reviews WHERE id = ?').bind(reviewId),
    recalculateBusinessRatingStmt(db, r.business_id, now),
    auditStmt(
      db,
      admin,
      {
        action: 'review.delete',
        targetType: 'review',
        targetId: reviewId,
        summary: `by ${r.author_name} on ${r.business_id}`,
      },
      now,
    ),
  ]);
}

export async function loadReportTargetFromDb(db: D1Database, reportId: string) {
  const report = await db
    .prepare('SELECT * FROM reports WHERE id = ?')
    .bind(reportId)
    .first<ReportDbRow>();
  if (!report) throw new ValidationError('Report was not found.', 404, 'NOT_FOUND');

  const checkOwnerIsAdmin = async (ownerId?: string | null) => {
    if (!ownerId) return false;
    const row = await db
      .prepare(
        `SELECT 1 AS is_admin FROM user u
         LEFT JOIN admin_records ar ON ar.user_id = u.id
         WHERE u.id = ? AND (u.role = 'admin' OR ar.user_id IS NOT NULL)`,
      )
      .bind(ownerId)
      .first<{ is_admin: number }>();
    return Boolean(row?.is_admin);
  };

  if (report.target_type === 'business') {
    const b = await db
      .prepare('SELECT * FROM businesses WHERE id = ?')
      .bind(report.target_id)
      .first<BusinessDbRow>();
    if (b) {
      return {
        kind: 'community' as const,
        title: cleanText(b.name, LIMITS.name),
        status: b.status,
        ownerId: b.owner_id,
        ownerName: cleanText(b.owner_name, LIMITS.displayName),
        excerpt: b.description ? cleanMultiline(b.description, 500) : undefined,
        ownerIsAdmin: await checkOwnerIsAdmin(b.owner_id),
      };
    }
    return { kind: 'not_in_d1' as const, title: report.target_title, ownerIsAdmin: false };
  }

  if (report.target_type === 'ad') {
    const a = await db
      .prepare('SELECT * FROM marketplace_items WHERE id = ?')
      .bind(report.target_id)
      .first<MarketplaceDbRow>();
    if (a) {
      return {
        kind: 'community' as const,
        title: cleanText(a.title, LIMITS.title),
        status: a.status,
        ownerId: a.owner_id,
        ownerName: cleanText(a.owner_name, LIMITS.displayName),
        excerpt: cleanMultiline(a.description, 500),
        ownerIsAdmin: await checkOwnerIsAdmin(a.owner_id),
      };
    }
    return { kind: 'not_in_d1' as const, title: report.target_title, ownerIsAdmin: false };
  }

  const rev = await db
    .prepare('SELECT * FROM reviews WHERE id = ?')
    .bind(report.target_id)
    .first<ReviewDbRow>();
  if (rev) {
    return {
      kind: 'community' as const,
      title: report.target_title,
      ownerId: rev.author_id,
      ownerName: cleanText(rev.author_name, LIMITS.displayName),
      excerpt: cleanMultiline(rev.comment, 500),
      ownerIsAdmin: await checkOwnerIsAdmin(rev.author_id),
    };
  }
  return { kind: 'missing' as const, title: report.target_title, ownerIsAdmin: false };
}

export async function actOnReport(
  db: D1Database,
  admin: AuthSessionUser,
  reportId: string,
  outcome: {
    status: 'resolved' | 'dismissed';
    note: string;
    removeContent?: boolean;
    targetKindHint?: 'community' | 'builtin' | 'missing';
    targetTitleHint?: string;
    banOwner?: { reason: string; email?: string; name?: string };
  },
) {
  const report = await db
    .prepare('SELECT * FROM reports WHERE id = ?')
    .bind(reportId)
    .first<ReportDbRow>();
  if (!report) throw new ValidationError('Report was not found.', 404, 'NOT_FOUND');

  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  const note = cleanText(outcome.note, 500) || (outcome.status === 'dismissed' ? 'No action needed' : 'Handled');

  // Inspect authoritative target owner/type from D1.
  let targetOwnerId: string | null = null;
  let targetTitle = cleanText(outcome.targetTitleHint || report.target_title, 150) || report.target_title;

  if (report.target_type === 'business') {
    const biz = await db
      .prepare('SELECT id, name, owner_id FROM businesses WHERE id = ?')
      .bind(report.target_id)
      .first<{ id: string; name: string; owner_id: string }>();
    if (biz) {
      targetOwnerId = biz.owner_id;
      targetTitle = biz.name;
      if (outcome.removeContent) {
        stmts.push(
          db
            .prepare(
              `UPDATE businesses
               SET status = 'removed', moderation_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
               WHERE id = ?`,
            )
            .bind(note, admin.id, now, now, biz.id),
        );
        stmts.push(
          auditStmt(
            db,
            admin,
            {
              action: 'business.remove_via_report',
              targetType: 'business',
              targetId: biz.id,
              summary: targetTitle,
            },
            now,
          ),
        );
      }
    } else if (outcome.removeContent && outcome.targetKindHint !== 'missing') {
      const ovrId = `business_${report.target_id}`;
      stmts.push(
        db
          .prepare(
            `INSERT INTO listing_overrides (id, kind, listing_id, hidden, verified, updated_by, updated_at)
             VALUES (?, 'business', ?, 1, 0, ?, ?)
             ON CONFLICT(id) DO UPDATE SET hidden = 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
          )
          .bind(ovrId, report.target_id, admin.id, now),
      );
      stmts.push(
        auditStmt(
          db,
          admin,
          {
            action: 'business.remove_via_report',
            targetType: 'business',
            targetId: report.target_id,
            summary: targetTitle,
          },
          now,
        ),
      );
    }
  } else if (report.target_type === 'ad') {
    const ad = await db
      .prepare('SELECT id, title, owner_id FROM marketplace_items WHERE id = ?')
      .bind(report.target_id)
      .first<{ id: string; title: string; owner_id: string }>();
    if (ad) {
      targetOwnerId = ad.owner_id;
      targetTitle = ad.title;
      if (outcome.removeContent) {
        stmts.push(
          db
            .prepare(
              `UPDATE marketplace_items
               SET status = 'removed', moderation_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
               WHERE id = ?`,
            )
            .bind(note, admin.id, now, now, ad.id),
        );
        stmts.push(
          auditStmt(
            db,
            admin,
            {
              action: 'ad.remove_via_report',
              targetType: 'ad',
              targetId: ad.id,
              summary: targetTitle,
            },
            now,
          ),
        );
      }
    } else if (outcome.removeContent && outcome.targetKindHint !== 'missing') {
      const ovrId = `marketplace_${report.target_id}`;
      stmts.push(
        db
          .prepare(
            `INSERT INTO listing_overrides (id, kind, listing_id, hidden, verified, updated_by, updated_at)
             VALUES (?, 'marketplace', ?, 1, 0, ?, ?)
             ON CONFLICT(id) DO UPDATE SET hidden = 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
          )
          .bind(ovrId, report.target_id, admin.id, now),
      );
      stmts.push(
        auditStmt(
          db,
          admin,
          {
            action: 'ad.remove_via_report',
            targetType: 'ad',
            targetId: report.target_id,
            summary: targetTitle,
          },
          now,
        ),
      );
    }
  } else {
    const rev = await db
      .prepare('SELECT id, business_id, author_id FROM reviews WHERE id = ?')
      .bind(report.target_id)
      .first<{ id: string; business_id: string; author_id: string }>();
    if (rev) {
      targetOwnerId = rev.author_id;
      if (outcome.removeContent) {
        stmts.push(db.prepare('DELETE FROM reviews WHERE id = ?').bind(rev.id));
        stmts.push(recalculateBusinessRatingStmt(db, rev.business_id, now));
        stmts.push(
          auditStmt(
            db,
            admin,
            {
              action: 'review.remove_via_report',
              targetType: 'review',
              targetId: rev.id,
              summary: targetTitle,
            },
            now,
          ),
        );
      }
    }
  }

  if (outcome.banOwner && targetOwnerId) {
    if (targetOwnerId === admin.id) {
      throw new ValidationError('You cannot suspend your own account.', 400, 'CANNOT_BAN_SELF');
    }
    const targetUser = await db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, ar.user_id AS admin_record_id
         FROM user u LEFT JOIN admin_records ar ON ar.user_id = u.id
         WHERE u.id = ?`,
      )
      .bind(targetOwnerId)
      .first<{ id: string; email: string; name: string; role: string; admin_record_id: string | null }>();

    if (targetUser && (targetUser.role === 'admin' || targetUser.admin_record_id)) {
      throw new ValidationError('Admins cannot be suspended.', 403, 'CANNOT_BAN_ADMIN');
    }

    const banReason = cleanText(outcome.banOwner.reason, 500) || note;
    stmts.push(
      db
        .prepare(
          `UPDATE user SET banned = 1, ban_reason = ?, banned_by = ?, banned_at = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(banReason, admin.id, now, now, targetOwnerId),
      db
        .prepare(
          `INSERT INTO user_bans (user_id, email, name, reason, banned_by, banned_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             reason = excluded.reason,
             banned_by = excluded.banned_by,
             banned_at = excluded.banned_at`,
        )
        .bind(
          targetOwnerId,
          cleanText(targetUser?.email || outcome.banOwner.email || '', 150),
          cleanText(targetUser?.name || outcome.banOwner.name || '', 100),
          banReason,
          admin.id,
          now,
        ),
      db.prepare('DELETE FROM session WHERE user_id = ?').bind(targetOwnerId),
      auditStmt(
        db,
        admin,
        { action: 'user.ban', targetType: 'user', targetId: targetOwnerId, summary: banReason },
        now,
      ),
    );
  }

  stmts.push(
    db
      .prepare(
        `UPDATE reports
         SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ?
         WHERE id = ?`,
      )
      .bind(outcome.status, note, admin.id, now, reportId),
    auditStmt(
      db,
      admin,
      {
        action: outcome.status === 'dismissed' ? 'report.dismiss' : 'report.resolve',
        targetType: 'report',
        targetId: reportId,
        summary: `${report.target_title}: ${note}`,
      },
      now,
    ),
  );

  await db.batch(stmts);
}

export async function approveClaim(
  db: D1Database,
  admin: AuthSessionUser,
  claimId: string,
  note: string,
) {
  const claim = await db
    .prepare('SELECT * FROM claims WHERE id = ?')
    .bind(claimId)
    .first<ClaimDbRow>();
  if (!claim) throw new ValidationError('Ownership claim was not found.', 404, 'NOT_FOUND');

  const biz = await db
    .prepare('SELECT id FROM businesses WHERE id = ?')
    .bind(claim.business_id)
    .first<{ id: string }>();

  const now = Date.now();
  const cleanNote = cleanText(note, 500);
  const stmts: D1PreparedStatement[] = [];

  if (biz) {
    stmts.push(
      db
        .prepare(
          `UPDATE businesses
           SET is_verified = 1, claimed = 1, reviewed_by = ?, reviewed_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(admin.id, now, now, biz.id),
    );
  } else {
    const ovrId = `business_${claim.business_id}`;
    stmts.push(
      db
        .prepare(
          `INSERT INTO listing_overrides (id, kind, listing_id, hidden, verified, claimed_by, updated_by, updated_at)
           VALUES (?, 'business', ?, 0, 1, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             hidden = 0,
             verified = 1,
             claimed_by = excluded.claimed_by,
             updated_by = excluded.updated_by,
             updated_at = excluded.updated_at`,
        )
        .bind(ovrId, claim.business_id, claim.claimant_id, admin.id, now),
    );
  }

  stmts.push(
    db
      .prepare(
        `UPDATE claims
         SET status = 'approved', review_note = ?, reviewed_by = ?, reviewed_at = ?
         WHERE id = ?`,
      )
      .bind(cleanNote || null, admin.id, now, claimId),
    auditStmt(
      db,
      admin,
      {
        action: 'claim.approve',
        targetType: 'claim',
        targetId: claimId,
        summary: `${claim.business_name} → ${claim.name}`,
      },
      now,
    ),
  );

  await db.batch(stmts);
  return { kind: biz ? ('community' as const) : ('builtin' as const) };
}

export async function rejectClaim(
  db: D1Database,
  admin: AuthSessionUser,
  claimId: string,
  note: string,
) {
  const cleanNote = cleanText(note, 500);
  if (!cleanNote) throw new ValidationError('Please provide a reason for rejecting this claim.');
  const claim = await db
    .prepare('SELECT id, business_name FROM claims WHERE id = ?')
    .bind(claimId)
    .first<{ id: string; business_name: string }>();
  if (!claim) throw new ValidationError('Ownership claim was not found.', 404, 'NOT_FOUND');

  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE claims
         SET status = 'rejected', review_note = ?, reviewed_by = ?, reviewed_at = ?
         WHERE id = ?`,
      )
      .bind(cleanNote, admin.id, now, claimId),
    auditStmt(
      db,
      admin,
      {
        action: 'claim.reject',
        targetType: 'claim',
        targetId: claimId,
        summary: `${claim.business_name}: ${cleanNote}`,
      },
      now,
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Users, Bans & Administrators
// ---------------------------------------------------------------------------

export async function banUser(
  db: D1Database,
  admin: AuthSessionUser,
  userId: string,
  reason: string,
  removeContent: boolean,
  fallbackMeta?: { email?: string; displayName?: string },
) {
  const cleanReason = cleanText(reason, 500);
  if (!cleanReason) throw new ValidationError('Please provide a reason for suspending this account.');
  if (userId === admin.id) {
    throw new ValidationError('You cannot suspend your own account.', 400, 'CANNOT_BAN_SELF');
  }

  const targetUser = await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, ar.user_id AS admin_record_id
       FROM user u LEFT JOIN admin_records ar ON ar.user_id = u.id
       WHERE u.id = ?`,
    )
    .bind(userId)
    .first<{ id: string; email: string; name: string; role: string; admin_record_id: string | null }>();

  if (!targetUser) {
    throw new ValidationError('Member account was not found.', 404, 'NOT_FOUND');
  }
  if (targetUser.role === 'admin' || targetUser.admin_record_id !== null) {
    throw new ValidationError('Administrators cannot be suspended.', 403, 'CANNOT_BAN_ADMIN');
  }

  const now = Date.now();
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE user
         SET banned = 1, ban_reason = ?, banned_by = ?, banned_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(cleanReason, admin.id, now, now, userId),
    db
      .prepare(
        `INSERT INTO user_bans (user_id, email, name, reason, banned_by, banned_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           email = excluded.email,
           name = excluded.name,
           reason = excluded.reason,
           banned_by = excluded.banned_by,
           banned_at = excluded.banned_at`,
      )
      .bind(
        userId,
        cleanText(targetUser.email || fallbackMeta?.email || '', 150),
        cleanText(targetUser.name || fallbackMeta?.displayName || '', 100),
        cleanReason,
        admin.id,
        now,
      ),
    db.prepare('DELETE FROM session WHERE user_id = ?').bind(userId),
  ];

  let removedCount = 0;
  let removedBizCount = 0;
  let removedAdsCount = 0;
  let removedReviewsCount = 0;

  if (removeContent) {
    const [bCountRow, aCountRow, affectedReviews] = await Promise.all([
      db
        .prepare("SELECT COUNT(*) AS count FROM businesses WHERE owner_id = ? AND status != 'removed'")
        .bind(userId)
        .first<{ count: number }>(),
      db
        .prepare("SELECT COUNT(*) AS count FROM marketplace_items WHERE owner_id = ? AND status != 'removed'")
        .bind(userId)
        .first<{ count: number }>(),
      db
        .prepare('SELECT DISTINCT business_id FROM reviews WHERE author_id = ?')
        .bind(userId)
        .all<{ business_id: string }>(),
    ]);

    const rCountRow = await db
      .prepare('SELECT COUNT(*) AS count FROM reviews WHERE author_id = ?')
      .bind(userId)
      .first<{ count: number }>();

    removedBizCount = Number(bCountRow?.count ?? 0);
    removedAdsCount = Number(aCountRow?.count ?? 0);
    removedReviewsCount = Number(rCountRow?.count ?? 0);
    removedCount = removedBizCount + removedAdsCount + removedReviewsCount;

    const note = 'Removed: the account that posted this was suspended.';
    stmts.push(
      db
        .prepare(
          `UPDATE businesses
           SET status = 'removed', moderation_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
           WHERE owner_id = ?`,
        )
        .bind(note, admin.id, now, now, userId),
      db
        .prepare(
          `UPDATE marketplace_items
           SET status = 'removed', moderation_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
           WHERE owner_id = ?`,
        )
        .bind(note, admin.id, now, now, userId),
      db.prepare('DELETE FROM reviews WHERE author_id = ?').bind(userId),
    );

    for (const row of affectedReviews.results) {
      stmts.push(recalculateBusinessRatingStmt(db, row.business_id, now));
    }
  }

  stmts.push(
    auditStmt(
      db,
      admin,
      {
        action: 'user.ban',
        targetType: 'user',
        targetId: userId,
        summary: `${targetUser.email || targetUser.name}: ${cleanReason}${
          removeContent
            ? ` (removed ${removedBizCount} listings, ${removedAdsCount} ads, ${removedReviewsCount} reviews)`
            : ''
        }`,
      },
      now,
    ),
  );

  await db.batch(stmts);
  return { removed: removedCount };
}

export async function unbanUser(db: D1Database, admin: AuthSessionUser, userId: string) {
  const targetUser = await db
    .prepare('SELECT id, email FROM user WHERE id = ?')
    .bind(userId)
    .first<{ id: string; email: string }>();

  const now = Date.now();
  await db.batch([
    db
      .prepare(
        'UPDATE user SET banned = 0, ban_reason = NULL, banned_by = NULL, banned_at = NULL, updated_at = ? WHERE id = ?',
      )
      .bind(now, userId),
    db.prepare('DELETE FROM user_bans WHERE user_id = ?').bind(userId),
    auditStmt(
      db,
      admin,
      {
        action: 'user.unban',
        targetType: 'user',
        targetId: userId,
        summary: targetUser?.email || userId,
      },
      now,
    ),
  ]);
}

export async function grantAdmin(db: D1Database, admin: AuthSessionUser, userId: string) {
  const targetUser = await db
    .prepare('SELECT id, email, banned FROM user WHERE id = ?')
    .bind(userId)
    .first<{ id: string; email: string; banned: number }>();

  if (!targetUser) throw new ValidationError('Member account was not found.', 404, 'NOT_FOUND');
  if (targetUser.banned === 1) {
    throw new ValidationError(
      'Reinstate this member before granting administrator rights.',
      400,
      'USER_BANNED',
    );
  }

  const now = Date.now();
  await db.batch([
    db.prepare("UPDATE user SET role = 'admin', updated_at = ? WHERE id = ?").bind(now, userId),
    db
      .prepare(
        `INSERT INTO admin_records (user_id, email, added_by, added_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, added_by = excluded.added_by, added_at = excluded.added_at`,
      )
      .bind(userId, cleanText(targetUser.email, 150), admin.id, now),
    auditStmt(
      db,
      admin,
      { action: 'admin.grant', targetType: 'user', targetId: userId, summary: targetUser.email },
      now,
    ),
  ]);
}

export async function revokeAdmin(db: D1Database, admin: AuthSessionUser, userId: string) {
  if (userId === admin.id) {
    throw new ValidationError(
      'You cannot remove your own administrator access.',
      400,
      'CANNOT_REVOKE_SELF',
    );
  }

  const targetUser = await db
    .prepare('SELECT id, email FROM user WHERE id = ?')
    .bind(userId)
    .first<{ id: string; email: string }>();

  const now = Date.now();
  await db.batch([
    db.prepare("UPDATE user SET role = 'user', updated_at = ? WHERE id = ?").bind(now, userId),
    db.prepare('DELETE FROM admin_records WHERE user_id = ?').bind(userId),
    auditStmt(
      db,
      admin,
      {
        action: 'admin.revoke',
        targetType: 'user',
        targetId: userId,
        summary: targetUser?.email || userId,
      },
      now,
    ),
  ]);
}

export async function loadUserActivity(db: D1Database, userId: string) {
  const [bRes, aRes, rRes] = await Promise.all([
    db
      .prepare('SELECT * FROM businesses WHERE owner_id = ? ORDER BY created_at DESC LIMIT 50')
      .bind(userId)
      .all<BusinessDbRow>(),
    db
      .prepare(
        `SELECT m.*, b.is_verified AS linked_business_verified
         FROM marketplace_items m
         LEFT JOIN businesses b ON b.id = m.business_id AND b.status = 'approved'
         WHERE m.owner_id = ?
         ORDER BY m.created_at DESC LIMIT 50`,
      )
      .bind(userId)
      .all<MarketplaceDbRow>(),
    db
      .prepare('SELECT * FROM reviews WHERE author_id = ? ORDER BY created_at DESC LIMIT 50')
      .bind(userId)
      .all<ReviewDbRow>(),
  ]);

  return {
    businesses: bRes.results.map(mapBusinessRow),
    ads: aRes.results.map(mapMarketplaceRow),
    reviews: rRes.results.map(mapReviewRow),
  };
}

// ---------------------------------------------------------------------------
// Messages, Newsletter Subscribers & Site Settings
// ---------------------------------------------------------------------------

export async function setMessageStatus(
  db: D1Database,
  id: string,
  status: 'new' | 'read' | 'archived',
) {
  if (status !== 'new' && status !== 'read' && status !== 'archived') {
    throw new ValidationError('Invalid message status.');
  }
  const res = await db
    .prepare('UPDATE contact_messages SET status = ? WHERE id = ?')
    .bind(status, id)
    .run();
  if ((res.meta?.changes ?? 0) === 0) {
    throw new ValidationError('Message was not found.', 404, 'NOT_FOUND');
  }
}

export async function deleteMessage(db: D1Database, admin: AuthSessionUser, id: string) {
  const msg = await db
    .prepare('SELECT id, subject FROM contact_messages WHERE id = ?')
    .bind(id)
    .first<{ id: string; subject: string }>();
  if (!msg) throw new ValidationError('Message was not found.', 404, 'NOT_FOUND');

  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM contact_messages WHERE id = ?').bind(id),
    auditStmt(
      db,
      admin,
      { action: 'message.delete', targetType: 'message', targetId: id, summary: msg.subject },
      now,
    ),
  ]);
}

export async function deleteSubscriber(
  db: D1Database,
  admin: AuthSessionUser,
  email: string,
) {
  const normalized = cleanText(email, 150).toLowerCase();
  const sub = await db
    .prepare('SELECT email FROM newsletter_subscribers WHERE email = ?')
    .bind(normalized)
    .first<{ email: string }>();
  if (!sub) throw new ValidationError('Subscriber was not found.', 404, 'NOT_FOUND');

  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM newsletter_subscribers WHERE email = ?').bind(normalized),
    auditStmt(
      db,
      admin,
      {
        action: 'subscriber.delete',
        targetType: 'subscriber',
        targetId: normalized,
        summary: normalized,
      },
      now,
    ),
  ]);
}

export async function saveSettings(
  db: D1Database,
  admin: AuthSessionUser,
  rawInput: Record<string, unknown>,
) {
  const clean = validateSettingsInput(rawInput);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO site_settings (
          id, contact_email, contact_phone, whatsapp, address, office_hours,
          about_story, announcement_enabled, announcement_text, ads_need_approval,
          updated_by, updated_at
        ) VALUES ('site', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          contact_email = excluded.contact_email,
          contact_phone = excluded.contact_phone,
          whatsapp = excluded.whatsapp,
          address = excluded.address,
          office_hours = excluded.office_hours,
          about_story = excluded.about_story,
          announcement_enabled = excluded.announcement_enabled,
          announcement_text = excluded.announcement_text,
          ads_need_approval = excluded.ads_need_approval,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at`,
      )
      .bind(
        clean.contactEmail,
        clean.contactPhone,
        clean.whatsapp,
        clean.address,
        clean.officeHours,
        clean.aboutStory,
        clean.announcementEnabled ? 1 : 0,
        clean.announcementText,
        clean.adsNeedApproval ? 1 : 0,
        admin.id,
        now,
      ),
    auditStmt(
      db,
      admin,
      {
        action: 'settings.update',
        targetType: 'settings',
        targetId: 'site',
        summary: `Ads need approval: ${clean.adsNeedApproval ? 'on' : 'off'}; announcement: ${clean.announcementEnabled ? 'on' : 'off'}`,
      },
      now,
    ),
  ]);
  return clean;
}
