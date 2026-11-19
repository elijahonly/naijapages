import { extractMediaKeyFromUrl } from '../lib/r2';
import {
  cleanEmail,
  cleanText,
  LIMITS,
  parseJsonArray,
  STATE_ZONE_MAP,
  validateBusinessInput,
  validateClaimInput,
  validateContactInput,
  validateReportInput,
  validateReviewInput,
  ValidationError,
} from '../lib/validation';
import type { AuthSessionUser, Bindings } from '../types';
import { cleanupMediaUrlsForActor } from './mediaService';
import {
  mapBusinessRow,
  mapClaimRow,
  mapMarketplaceRow,
  mapOverrideRow,
  mapReviewRow,
  mapSettingsRow,
  type BusinessDbRow,
  type CategoryDbRow,
  type ClaimDbRow,
  type MarketplaceDbRow,
  type OverrideDbRow,
  type ReviewDbRow,
  type SettingsDbRow,
} from './mappers';

export interface BusinessFilterParams {
  q?: string;
  category?: string;
  state?: string;
  lga?: string;
  zone?: string;
  verifiedOnly?: boolean;
  whatsappOnly?: boolean;
  minRating?: number;
  ownerId?: string;
  status?: string;
  sort?: 'rating' | 'newest' | 'reviews' | 'verified' | 'name';
  page?: number;
  pageSize?: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function ownerLabel(user: AuthSessionUser): string {
  return cleanText(user.name || user.email.split('@')[0] || 'Member', LIMITS.displayName) || 'Member';
}

export async function listCategories(db: D1Database, kind?: 'directory' | 'marketplace') {
  const sql = kind
    ? 'SELECT id, kind, key, label, emoji, sort_order, is_active FROM categories WHERE is_active = 1 AND kind = ? ORDER BY sort_order ASC'
    : 'SELECT id, kind, key, label, emoji, sort_order, is_active FROM categories WHERE is_active = 1 ORDER BY kind ASC, sort_order ASC';
  const stmt = kind ? db.prepare(sql).bind(kind) : db.prepare(sql);
  const res = await stmt.all<CategoryDbRow>();
  return res.results.map((c) => ({
    id: c.id,
    kind: c.kind as 'directory' | 'marketplace',
    key: c.key,
    label: c.label,
    emoji: c.emoji,
    sortOrder: Number(c.sort_order) || 0,
  }));
}

export async function getPublicBootstrap(db: D1Database) {
  const [bizRes, adRes, ovrRes, settingsRow, categories] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM businesses WHERE status = 'approved' ORDER BY created_at DESC LIMIT 500`,
      )
      .all<BusinessDbRow>(),
    db
      .prepare(
        `SELECT m.*, b.is_verified AS linked_business_verified
         FROM marketplace_items m
         LEFT JOIN businesses b ON b.id = m.business_id AND b.status = 'approved'
         WHERE m.status = 'active'
         ORDER BY m.created_at DESC
         LIMIT 500`,
      )
      .all<MarketplaceDbRow>(),
    db.prepare('SELECT * FROM listing_overrides').all<OverrideDbRow>(),
    db.prepare("SELECT * FROM site_settings WHERE id = 'site'").first<SettingsDbRow>(),
    listCategories(db),
  ]);

  return {
    businesses: bizRes.results.map(mapBusinessRow),
    marketplaceItems: adRes.results.map(mapMarketplaceRow),
    overrides: ovrRes.results.map(mapOverrideRow),
    settings: mapSettingsRow(settingsRow),
    categories,
  };
}

export async function listBusinesses(
  db: D1Database,
  params: BusinessFilterParams = {},
  viewer?: AuthSessionUser | null,
) {
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(params.pageSize ?? 24)));

  const where: string[] = [];
  const binds: unknown[] = [];

  // Public callers only ever see approved businesses unless owner/admin requests their own/moderation status.
  const canQueryOtherStatus =
    viewer?.role === 'admin' || (viewer && params.ownerId && params.ownerId === viewer.id);
  const effectiveStatus = canQueryOtherStatus && params.status ? params.status : 'approved';
  if (effectiveStatus !== 'all') {
    where.push('status = ?');
    binds.push(effectiveStatus);
  }

  if (params.ownerId) {
    where.push('owner_id = ?');
    binds.push(params.ownerId);
  }

  if (params.category && params.category !== 'All') {
    where.push('LOWER(category) = ?');
    binds.push(params.category.toLowerCase());
  }

  if (params.state) {
    const sel = params.state.trim().toLowerCase();
    if (sel === 'fct' || sel === 'abuja') {
      where.push("LOWER(state) IN ('fct', 'abuja')");
    } else if (sel === 'rivers' || sel === 'port harcourt') {
      where.push("LOWER(state) IN ('rivers', 'port harcourt')");
    } else if (sel === 'oyo' || sel === 'ibadan') {
      where.push("LOWER(state) IN ('oyo', 'ibadan')");
    } else {
      where.push('LOWER(state) = ?');
      binds.push(sel);
    }
  }

  if (params.lga) {
    where.push('LOWER(lga) = ?');
    binds.push(params.lga.trim().toLowerCase());
  }

  if (params.zone && params.zone !== 'ALL') {
    const zoneStates = Object.entries(STATE_ZONE_MAP)
      .filter(([, z]) => z === params.zone)
      .map(([st]) => st);
    if (zoneStates.length === 0) {
      return {
        items: [],
        pagination: { page, pageSize, total: 0, totalPages: 1 } satisfies PaginationMeta,
      };
    }
    where.push(`LOWER(state) IN (${zoneStates.map(() => '?').join(', ')})`);
    binds.push(...zoneStates);
  }

  if (params.verifiedOnly) {
    where.push('is_verified = 1');
  }

  if (params.whatsappOnly) {
    where.push("(COALESCE(whatsapp, '') != '' OR COALESCE(phone, '') != '')");
  }

  if (typeof params.minRating === 'number' && params.minRating > 0) {
    where.push('rating >= ?');
    binds.push(params.minRating);
  }

  if (params.q?.trim()) {
    const term = `%${params.q.trim().toLowerCase()}%`;
    where.push(
      `(LOWER(name) LIKE ? OR LOWER(category) LIKE ? OR LOWER(state) LIKE ? OR LOWER(lga) LIKE ? OR LOWER(address) LIKE ? OR LOWER(COALESCE(description, '')) LIKE ? OR LOWER(tags_json) LIKE ?)`,
    );
    binds.push(term, term, term, term, term, term, term);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = (() => {
    switch (params.sort) {
      case 'newest':
        return 'ORDER BY created_at DESC';
      case 'reviews':
        return 'ORDER BY reviews_count DESC, rating DESC, created_at DESC';
      case 'verified':
        return 'ORDER BY is_verified DESC, rating DESC, created_at DESC';
      case 'name':
        return 'ORDER BY LOWER(name) ASC';
      case 'rating':
      default:
        return 'ORDER BY (CASE WHEN reviews_count = 0 THEN 5.1 ELSE rating END) DESC, created_at DESC';
    }
  })();

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM businesses ${whereSql}`)
    .bind(...binds)
    .first<{ total: number }>();

  const total = Number(countRow?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;

  const listRes = await db
    .prepare(`SELECT * FROM businesses ${whereSql} ${orderSql} LIMIT ? OFFSET ?`)
    .bind(...binds, pageSize, offset)
    .all<BusinessDbRow>();

  return {
    items: listRes.results.map(mapBusinessRow),
    pagination: { page, pageSize, total, totalPages } satisfies PaginationMeta,
  };
}

export async function getBusinessById(
  db: D1Database,
  id: string,
  viewer?: AuthSessionUser | null,
) {
  const row = await db
    .prepare('SELECT * FROM businesses WHERE id = ?')
    .bind(id)
    .first<BusinessDbRow>();
  if (!row) return null;
  if (
    row.status !== 'approved' &&
    viewer?.role !== 'admin' &&
    viewer?.id !== row.owner_id
  ) {
    return null;
  }
  return mapBusinessRow(row);
}

export async function createBusiness(
  db: D1Database,
  user: AuthSessionUser,
  rawInput: Record<string, unknown>,
  publicBaseUrl?: string | null,
) {
  const clean = validateBusinessInput(rawInput);
  const id = crypto.randomUUID();
  const now = Date.now();
  const categoryId = `dir_${clean.category}`;

  await db
    .prepare(
      `INSERT INTO businesses (
        id, owner_id, owner_name, name, category, category_id, state, lga, address, landmark,
        phone, secondary_phone, whatsapp, email, website, google_map_url,
        cac_status, cac_number, year_established, price_level,
        payment_methods_json, socials_json, tags_json, opening_hours, description,
        logo_url, cover_image_url, gallery_json,
        rating, reviews_count, status, is_verified, claimed, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'pending', 0, 0, ?, ?)`,
    )
    .bind(
      id,
      user.id,
      ownerLabel(user),
      clean.name,
      clean.category,
      categoryId,
      clean.state,
      clean.lga,
      clean.address,
      clean.landmark ?? null,
      clean.phone,
      clean.secondaryPhone ?? null,
      clean.whatsapp ?? null,
      clean.email ?? null,
      clean.website ?? null,
      clean.googleMapUrl,
      clean.cacStatus ?? null,
      clean.cacNumber ?? null,
      clean.yearEstablished ?? null,
      clean.priceLevel ?? null,
      JSON.stringify(clean.paymentMethods),
      JSON.stringify(clean.socials),
      JSON.stringify(clean.tags),
      clean.openingHours ?? null,
      clean.description ?? null,
      clean.logoUrl ?? null,
      clean.coverImageUrl ?? null,
      JSON.stringify(clean.gallery),
      now,
      now,
    )
    .run();

  const mediaKeys = [clean.logoUrl, clean.coverImageUrl, ...clean.gallery]
    .map((u) => extractMediaKeyFromUrl(u, publicBaseUrl))
    .filter((k): k is string => Boolean(k));
  if (mediaKeys.length > 0) {
    await db.batch(
      mediaKeys.map((key) =>
        db
          .prepare(
            `UPDATE media_objects SET entity_type = 'business', entity_id = ?, updated_at = ?
             WHERE key = ? AND owner_id = ?`,
          )
          .bind(id, now, key, user.id),
      ),
    );
  }

  const created = await db.prepare('SELECT * FROM businesses WHERE id = ?').bind(id).first<BusinessDbRow>();
  return created ? mapBusinessRow(created) : null;
}

export async function updateBusinessByOwner(
  db: D1Database,
  id: string,
  user: AuthSessionUser,
  rawInput: Record<string, unknown>,
  mediaEnv?: Pick<Bindings, 'DB' | 'MEDIA_BUCKET' | 'R2_PUBLIC_BASE_URL'>,
) {
  const existing = await db
    .prepare('SELECT * FROM businesses WHERE id = ?')
    .bind(id)
    .first<BusinessDbRow>();

  if (!existing) {
    throw new ValidationError('Business listing was not found.', 404, 'NOT_FOUND');
  }
  if (existing.owner_id !== user.id && user.role !== 'admin') {
    throw new ValidationError('You can only edit your own business listing.', 403, 'FORBIDDEN');
  }
  if (existing.status === 'removed' && user.role !== 'admin') {
    throw new ValidationError('Removed listings cannot be edited.', 403, 'FORBIDDEN');
  }

  const clean = validateBusinessInput(rawInput);
  const now = Date.now();
  const categoryId = `dir_${clean.category}`;
  const nextStatus = existing.status === 'rejected' ? 'pending' : existing.status;
  const nextModerationNote = existing.status === 'rejected' ? null : existing.moderation_note;

  await db
    .prepare(
      `UPDATE businesses
       SET name = ?, category = ?,
           category_id = CASE WHEN EXISTS (SELECT 1 FROM categories WHERE id = ?) THEN ? ELSE category_id END,
           state = ?, lga = ?, address = ?, landmark = ?,
           phone = ?, secondary_phone = ?, whatsapp = ?, email = ?, website = ?, google_map_url = ?,
           cac_status = ?, cac_number = ?, year_established = ?, price_level = ?,
           payment_methods_json = ?, socials_json = ?, tags_json = ?, opening_hours = ?, description = ?,
           logo_url = ?, cover_image_url = ?, gallery_json = ?,
           status = ?, moderation_note = ?, updated_at = ?
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
      clean.landmark ?? null,
      clean.phone,
      clean.secondaryPhone ?? null,
      clean.whatsapp ?? null,
      clean.email ?? null,
      clean.website ?? null,
      clean.googleMapUrl,
      clean.cacStatus ?? null,
      clean.cacNumber ?? null,
      clean.yearEstablished ?? null,
      clean.priceLevel ?? null,
      JSON.stringify(clean.paymentMethods),
      JSON.stringify(clean.socials),
      JSON.stringify(clean.tags),
      clean.openingHours ?? null,
      clean.description ?? null,
      clean.logoUrl ?? null,
      clean.coverImageUrl ?? null,
      JSON.stringify(clean.gallery),
      nextStatus,
      nextModerationNote,
      now,
      id,
    )
    .run();

  const publicBaseUrl = mediaEnv?.R2_PUBLIC_BASE_URL;
  const nextUrls = [clean.logoUrl, clean.coverImageUrl, ...clean.gallery].filter(
    (u): u is string => Boolean(u),
  );
  const nextMediaKeys = nextUrls
    .map((u) => extractMediaKeyFromUrl(u, publicBaseUrl))
    .filter((k): k is string => Boolean(k));

  if (nextMediaKeys.length > 0) {
    await db.batch(
      nextMediaKeys.map((key) =>
        db
          .prepare(
            `UPDATE media_objects SET entity_type = 'business', entity_id = ?, updated_at = ?
             WHERE key = ? AND owner_id = ?`,
          )
          .bind(id, now, key, existing.owner_id),
      ),
    );
  }

  const prevUrls = [
    existing.logo_url,
    existing.cover_image_url,
    ...parseJsonArray(existing.gallery_json),
  ].filter((u): u is string => Boolean(u));
  const nextUrlSet = new Set(nextUrls);
  const removedUrls = prevUrls.filter((u) => !nextUrlSet.has(u));

  if (removedUrls.length > 0 && mediaEnv?.MEDIA_BUCKET) {
    await cleanupMediaUrlsForActor(mediaEnv, user, removedUrls);
  }

  const updated = await db.prepare('SELECT * FROM businesses WHERE id = ?').bind(id).first<BusinessDbRow>();
  return updated ? mapBusinessRow(updated) : null;
}

export async function deleteBusinessByOwner(
  db: D1Database,
  id: string,
  user: AuthSessionUser,
  mediaEnv?: Pick<Bindings, 'DB' | 'MEDIA_BUCKET' | 'R2_PUBLIC_BASE_URL'>,
) {
  const existing = await db
    .prepare('SELECT id, owner_id, logo_url, cover_image_url, gallery_json FROM businesses WHERE id = ?')
    .bind(id)
    .first<{
      id: string;
      owner_id: string;
      logo_url: string | null;
      cover_image_url: string | null;
      gallery_json: string | null;
    }>();

  if (!existing) {
    throw new ValidationError('Business listing was not found.', 404, 'NOT_FOUND');
  }
  if (existing.owner_id !== user.id && user.role !== 'admin') {
    throw new ValidationError('You can only delete your own listing.', 403, 'FORBIDDEN');
  }

  await db.prepare('DELETE FROM businesses WHERE id = ?').bind(id).run();

  if (mediaEnv?.MEDIA_BUCKET) {
    await cleanupMediaUrlsForActor(mediaEnv, user, [
      existing.logo_url,
      existing.cover_image_url,
      ...parseJsonArray(existing.gallery_json),
    ]);
  }
}

export async function fetchMySubmissions(db: D1Database, userId: string) {
  const [bRes, aRes, cRes] = await Promise.all([
    db
      .prepare('SELECT * FROM businesses WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100')
      .bind(userId)
      .all<BusinessDbRow>(),
    db
      .prepare(
        `SELECT m.*, b.is_verified AS linked_business_verified
         FROM marketplace_items m
         LEFT JOIN businesses b ON b.id = m.business_id AND b.status = 'approved'
         WHERE m.owner_id = ?
         ORDER BY m.created_at DESC
         LIMIT 100`,
      )
      .bind(userId)
      .all<MarketplaceDbRow>(),
    db
      .prepare('SELECT * FROM claims WHERE claimant_id = ? ORDER BY created_at DESC LIMIT 50')
      .bind(userId)
      .all<ClaimDbRow>(),
  ]);

  return {
    businesses: bRes.results.map(mapBusinessRow),
    ads: aRes.results.map(mapMarketplaceRow),
    claims: cRes.results.map(mapClaimRow),
  };
}

// ---------------------------------------------------------------------------
// Reviews & Atomic Business Rating Recalculation
// ---------------------------------------------------------------------------

export function recalculateBusinessRatingStmt(db: D1Database, businessId: string, now: number) {
  return db
    .prepare(
      `UPDATE businesses
       SET rating = COALESCE((SELECT ROUND(AVG(rating), 1) FROM reviews WHERE business_id = ?), 0),
           reviews_count = (SELECT COUNT(*) FROM reviews WHERE business_id = ?),
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(businessId, businessId, now, businessId);
}

export async function listReviews(
  db: D1Database,
  businessId: string,
  page = 1,
  pageSize = 100,
) {
  const safePage = Math.max(1, Math.trunc(page));
  const safeSize = Math.min(100, Math.max(1, Math.trunc(pageSize)));
  const offset = (safePage - 1) * safeSize;

  const [countRow, rows] = await Promise.all([
    db
      .prepare('SELECT COUNT(*) AS total FROM reviews WHERE business_id = ?')
      .bind(businessId)
      .first<{ total: number }>(),
    db
      .prepare(
        'SELECT * FROM reviews WHERE business_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      )
      .bind(businessId, safeSize, offset)
      .all<ReviewDbRow>(),
  ]);

  const total = Number(countRow?.total ?? 0);
  return {
    items: rows.results.map(mapReviewRow),
    pagination: {
      page: safePage,
      pageSize: safeSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeSize)),
    } satisfies PaginationMeta,
  };
}

export async function createReview(
  db: D1Database,
  user: AuthSessionUser,
  businessId: string,
  rawInput: Record<string, unknown>,
) {
  const cleanBizId = cleanText(businessId, 160);
  if (!cleanBizId) {
    throw new ValidationError('Missing business identifier.');
  }
  const { rating, comment } = validateReviewInput(rawInput);

  // If this is a community business in D1, prevent owners from reviewing their own listing.
  const biz = await db
    .prepare('SELECT id, owner_id, status FROM businesses WHERE id = ?')
    .bind(cleanBizId)
    .first<{ id: string; owner_id: string; status: string }>();

  if (biz && biz.owner_id === user.id) {
    throw new ValidationError(
      'You can’t review your own business.',
      403,
      'CANNOT_REVIEW_OWN_BUSINESS',
    );
  }
  if (biz && biz.status !== 'approved') {
    throw new ValidationError(
      'Reviews can only be submitted on approved business listings.',
      400,
      'BUSINESS_NOT_APPROVED',
    );
  }

  const existing = await db
    .prepare('SELECT id FROM reviews WHERE business_id = ? AND author_id = ?')
    .bind(cleanBizId, user.id)
    .first<{ id: string }>();

  if (existing) {
    throw new ValidationError(
      "You've already reviewed this business.",
      409,
      'ALREADY_REVIEWED',
    );
  }

  const id = `${cleanBizId}_${user.id}`;
  const now = Date.now();

  const stmts = [
    db
      .prepare(
        'INSERT INTO reviews (id, business_id, author_id, author_name, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(id, cleanBizId, user.id, ownerLabel(user), rating, comment, now),
  ];

  if (biz) {
    stmts.push(recalculateBusinessRatingStmt(db, cleanBizId, now));
  }

  await db.batch(stmts);
  const created = await db.prepare('SELECT * FROM reviews WHERE id = ?').bind(id).first<ReviewDbRow>();
  return created ? mapReviewRow(created) : null;
}

export async function deleteReviewByAuthorOrAdmin(
  db: D1Database,
  reviewId: string,
  user: AuthSessionUser,
) {
  const existing = await db
    .prepare('SELECT id, business_id, author_id FROM reviews WHERE id = ?')
    .bind(reviewId)
    .first<{ id: string; business_id: string; author_id: string }>();

  if (!existing) {
    throw new ValidationError('Review was not found.', 404, 'NOT_FOUND');
  }
  if (existing.author_id !== user.id && user.role !== 'admin') {
    throw new ValidationError('You can only delete your own review.', 403, 'FORBIDDEN');
  }

  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM reviews WHERE id = ?').bind(reviewId),
    recalculateBusinessRatingStmt(db, existing.business_id, now),
  ]);
}

// ---------------------------------------------------------------------------
// Favourites / Saved Businesses
// ---------------------------------------------------------------------------

export async function listFavourites(db: D1Database, userId: string): Promise<string[]> {
  const res = await db
    .prepare('SELECT business_id FROM favourites WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all<{ business_id: string }>();
  return res.results.map((r) => r.business_id);
}

export async function addFavourite(db: D1Database, userId: string, businessId: string) {
  const cleanId = cleanText(businessId, 160);
  if (!cleanId) throw new ValidationError('Missing business identifier.');
  await db
    .prepare(
      'INSERT OR IGNORE INTO favourites (id, user_id, business_id, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(`${userId}_${cleanId}`, userId, cleanId, Date.now())
    .run();
  return listFavourites(db, userId);
}

export async function removeFavourite(db: D1Database, userId: string, businessId: string) {
  const cleanId = cleanText(businessId, 160);
  if (!cleanId) throw new ValidationError('Missing business identifier.');
  await db
    .prepare('DELETE FROM favourites WHERE user_id = ? AND business_id = ?')
    .bind(userId, cleanId)
    .run();
  return listFavourites(db, userId);
}

export async function syncFavourites(
  db: D1Database,
  userId: string,
  businessIds: unknown[],
): Promise<string[]> {
  const uniqueIds = Array.from(
    new Set(
      businessIds
        .map((id) => cleanText(id, 160))
        .filter(Boolean)
        .slice(0, 200),
    ),
  );
  if (uniqueIds.length > 0) {
    const now = Date.now();
    await db.batch(
      uniqueIds.map((bizId, idx) =>
        db
          .prepare(
            'INSERT OR IGNORE INTO favourites (id, user_id, business_id, created_at) VALUES (?, ?, ?, ?)',
          )
          .bind(`${userId}_${bizId}`, userId, bizId, now + idx),
      ),
    );
  }
  return listFavourites(db, userId);
}

// ---------------------------------------------------------------------------
// Claims, Reports, Contact Messages, Newsletter
// ---------------------------------------------------------------------------

export async function submitClaim(
  db: D1Database,
  user: AuthSessionUser,
  rawInput: Record<string, unknown>,
  publicBaseUrl?: string | null,
) {
  const clean = validateClaimInput(rawInput);

  const existing = await db
    .prepare('SELECT id FROM claims WHERE business_id = ? AND claimant_id = ?')
    .bind(clean.businessId, user.id)
    .first<{ id: string }>();

  if (existing) {
    throw new ValidationError(
      "If you've already claimed this business, our team is reviewing it.",
      409,
      'ALREADY_EXISTS',
    );
  }

  const id = `${clean.businessId}_${user.id}`;
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO claims (
        id, business_id, business_name, claimant_id, name, email, phone, role, proof_note, proof_attachment_url, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(
      id,
      clean.businessId,
      clean.businessName,
      user.id,
      clean.name,
      clean.email,
      clean.phone,
      clean.role,
      clean.proofNote ?? null,
      clean.proofAttachmentUrl ?? null,
      now,
    )
    .run();

  const proofKey = clean.proofAttachmentUrl
    ? extractMediaKeyFromUrl(clean.proofAttachmentUrl, publicBaseUrl)
    : null;
  if (proofKey) {
    await db
      .prepare(
        `UPDATE media_objects SET entity_type = 'claim', entity_id = ?, updated_at = ?
         WHERE key = ? AND owner_id = ?`,
      )
      .bind(id, now, proofKey, user.id)
      .run();
  }

  return { id, status: 'pending' as const };
}

export async function submitReport(
  db: D1Database,
  user: AuthSessionUser,
  rawInput: Record<string, unknown>,
) {
  const clean = validateReportInput(rawInput);

  const existing = await db
    .prepare('SELECT id FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ?')
    .bind(user.id, clean.targetType, clean.targetId)
    .first<{ id: string }>();

  if (existing) {
    throw new ValidationError(
      "If you've already reported this, our team is already looking into it.",
      409,
      'ALREADY_EXISTS',
    );
  }

  const id = `${user.id}_${clean.targetType}_${clean.targetId}`;
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO reports (
        id, target_type, target_id, target_title, reason, details, reporter_id, reporter_name, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    )
    .bind(
      id,
      clean.targetType,
      clean.targetId,
      clean.targetTitle,
      clean.reason,
      clean.details ?? null,
      user.id,
      ownerLabel(user),
      now,
    )
    .run();

  return { id, status: 'open' as const };
}

export async function submitContactMessage(
  db: D1Database,
  user: AuthSessionUser | null,
  rawInput: Record<string, unknown>,
) {
  const clean = validateContactInput(rawInput);
  const id = crypto.randomUUID();
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO contact_messages (id, uid, name, email, subject, message, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'new', ?)`,
    )
    .bind(id, user?.id ?? null, clean.name, clean.email, clean.subject, clean.message, now)
    .run();

  return { id };
}

export async function subscribeNewsletter(
  db: D1Database,
  emailInput: unknown,
  sourceInput: unknown,
) {
  const email = cleanEmail(emailInput);
  if (!email) {
    throw new ValidationError('Please provide a valid email address.');
  }
  const source = cleanText(sourceInput, 50) || 'homepage_banner';
  const now = Date.now();
  const iso = new Date(now).toISOString();

  // Duplicate emails succeed silently so the mailing list can never be probed.
  await db
    .prepare(
      `INSERT OR IGNORE INTO newsletter_subscribers (email, source, status, subscribed_at, created_at)
       VALUES (?, ?, 'active', ?, ?)`,
    )
    .bind(email, source, iso, now)
    .run();

  return { subscribed: true };
}
