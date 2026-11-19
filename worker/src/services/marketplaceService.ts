import { extractMediaKeyFromUrl } from '../lib/r2';
import { cleanText, LIMITS, parseJsonArray, validateAdInput, ValidationError } from '../lib/validation';
import type { AuthSessionUser, Bindings } from '../types';
import type { PaginationMeta } from './directoryService';
import { mapMarketplaceRow, type MarketplaceDbRow } from './mappers';
import { cleanupMediaUrlsForActor } from './mediaService';

export interface MarketplaceFilterParams {
  q?: string;
  category?: string;
  state?: string;
  lga?: string;
  condition?: string;
  minPrice?: number;
  maxPrice?: number;
  negotiableOnly?: boolean;
  ownerId?: string;
  status?: string;
  sort?: 'newest' | 'price_asc' | 'price_desc';
  page?: number;
  pageSize?: number;
}

function ownerLabel(user: AuthSessionUser): string {
  return cleanText(user.name || user.email.split('@')[0] || 'Member', LIMITS.displayName) || 'Member';
}

export async function listMarketplaceItems(
  db: D1Database,
  params: MarketplaceFilterParams = {},
  viewer?: AuthSessionUser | null,
) {
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(params.pageSize ?? 24)));

  const where: string[] = [];
  const binds: unknown[] = [];

  const canQueryOtherStatus =
    viewer?.role === 'admin' || (viewer && params.ownerId && params.ownerId === viewer.id);
  const effectiveStatus = canQueryOtherStatus && params.status ? params.status : 'active';
  if (effectiveStatus !== 'all') {
    where.push('m.status = ?');
    binds.push(effectiveStatus);
  }

  if (params.ownerId) {
    where.push('m.owner_id = ?');
    binds.push(params.ownerId);
  }

  if (params.category && params.category !== 'All') {
    where.push('LOWER(m.category) = ?');
    binds.push(params.category.toLowerCase());
  }

  if (params.state) {
    const sel = params.state.trim().toLowerCase();
    if (sel === 'fct' || sel === 'abuja') {
      where.push("LOWER(m.state) IN ('fct', 'abuja')");
    } else if (sel === 'rivers' || sel === 'port harcourt') {
      where.push("LOWER(m.state) IN ('rivers', 'port harcourt')");
    } else if (sel === 'oyo' || sel === 'ibadan') {
      where.push("LOWER(m.state) IN ('oyo', 'ibadan')");
    } else {
      where.push('LOWER(m.state) = ?');
      binds.push(sel);
    }
  }

  if (params.lga) {
    where.push('LOWER(m.lga) = ?');
    binds.push(params.lga.trim().toLowerCase());
  }

  if (params.condition && params.condition !== 'All') {
    where.push('m.condition = ?');
    binds.push(params.condition);
  }

  if (typeof params.minPrice === 'number' && params.minPrice > 0) {
    where.push('m.price >= ?');
    binds.push(Math.round(params.minPrice));
  }

  if (typeof params.maxPrice === 'number' && params.maxPrice > 0) {
    where.push('m.price <= ?');
    binds.push(Math.round(params.maxPrice));
  }

  if (params.negotiableOnly) {
    where.push('m.is_negotiable = 1');
  }

  if (params.q?.trim()) {
    const term = `%${params.q.trim().toLowerCase()}%`;
    where.push(
      `(LOWER(m.title) LIKE ? OR LOWER(m.business_name) LIKE ? OR LOWER(m.category) LIKE ? OR LOWER(m.description) LIKE ? OR LOWER(COALESCE(m.location_hub, '')) LIKE ? OR LOWER(m.state) LIKE ? OR LOWER(m.lga) LIKE ?)`,
    );
    binds.push(term, term, term, term, term, term, term);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = (() => {
    switch (params.sort) {
      case 'price_asc':
        return 'ORDER BY m.price ASC, m.created_at DESC';
      case 'price_desc':
        return 'ORDER BY m.price DESC, m.created_at DESC';
      case 'newest':
      default:
        return 'ORDER BY m.created_at DESC';
    }
  })();

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM marketplace_items m ${whereSql}`)
    .bind(...binds)
    .first<{ total: number }>();

  const total = Number(countRow?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;

  const listRes = await db
    .prepare(
      `SELECT m.*, b.is_verified AS linked_business_verified
       FROM marketplace_items m
       LEFT JOIN businesses b ON b.id = m.business_id AND b.status = 'approved'
       ${whereSql}
       ${orderSql}
       LIMIT ? OFFSET ?`,
    )
    .bind(...binds, pageSize, offset)
    .all<MarketplaceDbRow>();

  return {
    items: listRes.results.map(mapMarketplaceRow),
    pagination: { page, pageSize, total, totalPages } satisfies PaginationMeta,
  };
}

export async function createMarketplaceAd(
  db: D1Database,
  user: AuthSessionUser,
  rawInput: Record<string, unknown>,
  publicBaseUrl?: string | null,
) {
  const clean = validateAdInput(rawInput);

  // Verify linked business ownership if businessId was supplied.
  if (clean.businessId) {
    const biz = await db
      .prepare('SELECT id, owner_id FROM businesses WHERE id = ?')
      .bind(clean.businessId)
      .first<{ id: string; owner_id: string }>();
    if (!biz) {
      throw new ValidationError('Linked business listing was not found.', 400, 'INVALID_BUSINESS');
    }
    if (biz.owner_id !== user.id) {
      throw new ValidationError(
        'You can only link an ad to a business listing you own.',
        403,
        'FORBIDDEN',
      );
    }
  }

  // Always check authoritative ads_need_approval setting in D1.
  const settings = await db
    .prepare("SELECT ads_need_approval FROM site_settings WHERE id = 'site'")
    .first<{ ads_need_approval: number }>();
  const status = settings?.ads_need_approval === 1 ? 'pending' : 'active';

  const id = crypto.randomUUID();
  const now = Date.now();
  const categoryId = `mkt_${clean.category}`;

  await db
    .prepare(
      `INSERT INTO marketplace_items (
        id, owner_id, owner_name, business_id, business_name, title, category, category_id,
        price, is_negotiable, condition, description, image_url, additional_images_json,
        state, lga, location_hub, phone, whatsapp, cac_number,
        featured, views_count, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
    )
    .bind(
      id,
      user.id,
      ownerLabel(user),
      clean.businessId ?? null,
      clean.businessName,
      clean.title,
      clean.category,
      categoryId,
      clean.price,
      clean.isNegotiable ? 1 : 0,
      clean.condition,
      clean.description,
      clean.imageUrl,
      JSON.stringify(clean.additionalImages),
      clean.state,
      clean.lga,
      clean.locationHub ?? null,
      clean.phone,
      clean.whatsapp ?? null,
      clean.cacNumber ?? null,
      status,
      now,
      now,
    )
    .run();

  const mediaKeys = [clean.imageUrl, ...clean.additionalImages]
    .map((u) => extractMediaKeyFromUrl(u, publicBaseUrl))
    .filter((k): k is string => Boolean(k));
  if (mediaKeys.length > 0) {
    await db.batch(
      mediaKeys.map((key) =>
        db
          .prepare(
            `UPDATE media_objects SET entity_type = 'marketplace_item', entity_id = ?, updated_at = ?
             WHERE key = ? AND owner_id = ?`,
          )
          .bind(id, now, key, user.id),
      ),
    );
  }

  const created = await db
    .prepare(
      `SELECT m.*, b.is_verified AS linked_business_verified
       FROM marketplace_items m
       LEFT JOIN businesses b ON b.id = m.business_id AND b.status = 'approved'
       WHERE m.id = ?`,
    )
    .bind(id)
    .first<MarketplaceDbRow>();

  return created ? mapMarketplaceRow(created) : { id, status };
}

export async function deleteAdByOwner(
  db: D1Database,
  id: string,
  user: AuthSessionUser,
  mediaEnv?: Pick<Bindings, 'DB' | 'MEDIA_BUCKET' | 'R2_PUBLIC_BASE_URL'>,
) {
  const existing = await db
    .prepare('SELECT id, owner_id, image_url, additional_images_json FROM marketplace_items WHERE id = ?')
    .bind(id)
    .first<{
      id: string;
      owner_id: string;
      image_url: string | null;
      additional_images_json: string | null;
    }>();

  if (!existing) {
    throw new ValidationError('Marketplace ad was not found.', 404, 'NOT_FOUND');
  }
  if (existing.owner_id !== user.id && user.role !== 'admin') {
    throw new ValidationError('You can only delete your own ad.', 403, 'FORBIDDEN');
  }

  await db.prepare('DELETE FROM marketplace_items WHERE id = ?').bind(id).run();

  if (mediaEnv?.MEDIA_BUCKET) {
    await cleanupMediaUrlsForActor(mediaEnv, user, [
      existing.image_url,
      ...parseJsonArray(existing.additional_images_json),
    ]);
  }
}
