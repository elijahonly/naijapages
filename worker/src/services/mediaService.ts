import {
  allowedMimeTypesForPurpose,
  buildMediaDeliveryUrl,
  buildUniqueMediaKey,
  defaultVisibilityForPurpose,
  detectMagicMimeType,
  extractMediaKeyFromUrl,
  MAX_SIZE_BYTES_BY_PURPOSE,
  MEDIA_ENTITY_TYPES,
  MEDIA_PURPOSES,
  normalizeDeclaredMimeType,
  normalizeMediaKey,
  sha256Hex,
  type MediaEntityType,
  type MediaPurpose,
  type MediaVisibility,
} from '../lib/r2';
import { cleanText, parseJsonArray, safeMediaUrl, ValidationError } from '../lib/validation';
import type { AuthSessionUser, Bindings } from '../types';

export interface MediaObjectDbRow {
  key: string;
  owner_id: string;
  purpose: string;
  entity_type: string | null;
  entity_id: string | null;
  visibility: string;
  content_type: string;
  size_bytes: number;
  sha256: string | null;
  original_filename: string | null;
  created_at: number;
  updated_at: number;
}

export interface MediaRecord {
  key: string;
  url: string;
  purpose: MediaPurpose;
  visibility: MediaVisibility;
  entityType?: MediaEntityType;
  entityId?: string;
  contentType: string;
  sizeBytes: number;
  sha256?: string;
  originalFilename?: string;
  createdAt: number;
  updatedAt: number;
}

function mapMediaRow(row: MediaObjectDbRow, publicBaseUrl?: string | null): MediaRecord {
  const visibility: MediaVisibility = row.visibility === 'private' ? 'private' : 'public';
  const purpose = (MEDIA_PURPOSES as readonly string[]).includes(row.purpose)
    ? (row.purpose as MediaPurpose)
    : 'general';
  const entityType =
    row.entity_type && (MEDIA_ENTITY_TYPES as readonly string[]).includes(row.entity_type)
      ? (row.entity_type as MediaEntityType)
      : undefined;

  return {
    key: row.key,
    url: buildMediaDeliveryUrl(row.key, visibility, publicBaseUrl),
    purpose,
    visibility,
    entityType,
    entityId: row.entity_id ?? undefined,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes) || 0,
    sha256: row.sha256 ?? undefined,
    originalFilename: row.original_filename ?? undefined,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

function candidateUrlsForKey(key: string, publicBaseUrl?: string | null): string[] {
  const urls = new Set<string>([`/api/media/${key}`]);
  const publicUrl = buildMediaDeliveryUrl(key, 'public', publicBaseUrl);
  urls.add(publicUrl);
  return Array.from(urls);
}

async function rewriteMediaReferences(
  db: D1Database,
  oldUrls: string[],
  newUrl: string | null,
  now: number,
) {
  const targets = Array.from(new Set(oldUrls.filter(Boolean)));
  if (targets.length === 0) return;

  for (const oldUrl of targets) {
    // 1. User avatars
    await db
      .prepare('UPDATE user SET image = ?, updated_at = ? WHERE image = ?')
      .bind(newUrl, now, oldUrl)
      .run();

    // 2. Business logo & cover photo
    await db
      .prepare('UPDATE businesses SET logo_url = ?, updated_at = ? WHERE logo_url = ?')
      .bind(newUrl, now, oldUrl)
      .run();
    await db
      .prepare('UPDATE businesses SET cover_image_url = ?, updated_at = ? WHERE cover_image_url = ?')
      .bind(newUrl, now, oldUrl)
      .run();

    // 3. Business galleries (JSON array)
    const bizGalleries = await db
      .prepare('SELECT id, gallery_json FROM businesses WHERE gallery_json LIKE ?')
      .bind(`%${oldUrl}%`)
      .all<{ id: string; gallery_json: string }>();
    for (const row of bizGalleries.results) {
      const items = parseJsonArray(row.gallery_json);
      if (!items.includes(oldUrl)) continue;
      const nextItems = newUrl
        ? items.map((u) => (u === oldUrl ? newUrl : u))
        : items.filter((u) => u !== oldUrl);
      await db
        .prepare('UPDATE businesses SET gallery_json = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(nextItems), now, row.id)
        .run();
    }

    // 4. Marketplace main image (fallback to first additional or empty placeholder cleared on delete)
    const mktMain = await db
      .prepare('SELECT id, additional_images_json FROM marketplace_items WHERE image_url = ?')
      .bind(oldUrl)
      .all<{ id: string; additional_images_json: string }>();
    for (const row of mktMain.results) {
      if (newUrl) {
        await db
          .prepare('UPDATE marketplace_items SET image_url = ?, updated_at = ? WHERE id = ?')
          .bind(newUrl, now, row.id)
          .run();
      } else {
        const extras = parseJsonArray(row.additional_images_json).filter((u) => u !== oldUrl);
        const promoted = extras[0] ?? '';
        const remaining = promoted ? extras.slice(1) : [];
        await db
          .prepare(
            'UPDATE marketplace_items SET image_url = ?, additional_images_json = ?, updated_at = ? WHERE id = ?',
          )
          .bind(promoted, JSON.stringify(remaining), now, row.id)
          .run();
      }
    }

    // 5. Marketplace additional images (JSON array)
    const mktExtras = await db
      .prepare(
        'SELECT id, additional_images_json FROM marketplace_items WHERE additional_images_json LIKE ?',
      )
      .bind(`%${oldUrl}%`)
      .all<{ id: string; additional_images_json: string }>();
    for (const row of mktExtras.results) {
      const items = parseJsonArray(row.additional_images_json);
      if (!items.includes(oldUrl)) continue;
      const nextItems = newUrl
        ? items.map((u) => (u === oldUrl ? newUrl : u))
        : items.filter((u) => u !== oldUrl);
      await db
        .prepare('UPDATE marketplace_items SET additional_images_json = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(nextItems), now, row.id)
        .run();
    }

    // 6. Claim proof attachment
    await db
      .prepare('UPDATE claims SET proof_attachment_url = ? WHERE proof_attachment_url = ?')
      .bind(newUrl, oldUrl)
      .run();
  }
}

async function assertEntityOwnership(
  db: D1Database,
  user: AuthSessionUser,
  entityType: MediaEntityType,
  entityId: string,
) {
  if (user.role === 'admin') return;

  if (entityType === 'user') {
    if (entityId !== user.id) {
      throw new ValidationError('You cannot attach media to another user account.', 403, 'FORBIDDEN');
    }
    return;
  }

  if (entityType === 'business') {
    const row = await db
      .prepare('SELECT owner_id FROM businesses WHERE id = ?')
      .bind(entityId)
      .first<{ owner_id: string }>();
    if (!row) {
      throw new ValidationError('Business listing was not found.', 404, 'NOT_FOUND');
    }
    if (row.owner_id !== user.id) {
      throw new ValidationError('You can only upload media for your own business listing.', 403, 'FORBIDDEN');
    }
    return;
  }

  if (entityType === 'marketplace_item') {
    const row = await db
      .prepare('SELECT owner_id FROM marketplace_items WHERE id = ?')
      .bind(entityId)
      .first<{ owner_id: string }>();
    if (!row) {
      throw new ValidationError('Marketplace listing was not found.', 404, 'NOT_FOUND');
    }
    if (row.owner_id !== user.id) {
      throw new ValidationError('You can only upload media for your own ad listing.', 403, 'FORBIDDEN');
    }
    return;
  }

  if (entityType === 'claim') {
    const row = await db
      .prepare('SELECT claimant_id FROM claims WHERE id = ?')
      .bind(entityId)
      .first<{ claimant_id: string }>();
    if (!row) {
      throw new ValidationError('Claim record was not found.', 404, 'NOT_FOUND');
    }
    if (row.claimant_id !== user.id) {
      throw new ValidationError('You can only attach proof to your own claim.', 403, 'FORBIDDEN');
    }
  }
}

export async function uploadMedia(
  env: Bindings,
  user: AuthSessionUser,
  opts: {
    file: File;
    purpose?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    replaceKey?: string | null;
  },
): Promise<MediaRecord> {
  if (!env.MEDIA_BUCKET) {
    throw new ValidationError('Cloudflare R2 storage binding is not configured.', 503, 'R2_UNAVAILABLE');
  }

  const rawPurpose = cleanText(opts.purpose, 40) || 'general';
  if (!(MEDIA_PURPOSES as readonly string[]).includes(rawPurpose)) {
    throw new ValidationError('Unsupported media upload purpose.', 400, 'INVALID_MEDIA_PURPOSE');
  }
  const purpose = rawPurpose as MediaPurpose;

  const rawEntityType = cleanText(opts.entityType, 40);
  let entityType: MediaEntityType | undefined;
  if (rawEntityType) {
    if (!(MEDIA_ENTITY_TYPES as readonly string[]).includes(rawEntityType)) {
      throw new ValidationError('Unsupported entity type.', 400, 'INVALID_ENTITY_TYPE');
    }
    entityType = rawEntityType as MediaEntityType;
  }
  const entityId = cleanText(opts.entityId, 160) || undefined;
  if (entityId && entityType) {
    await assertEntityOwnership(env.DB, user, entityType, entityId);
  }

  let existingToReplace: MediaObjectDbRow | null = null;
  if (opts.replaceKey) {
    const normalizedReplace = normalizeMediaKey(opts.replaceKey);
    if (!normalizedReplace) {
      throw new ValidationError('Invalid replacement media key.', 400, 'INVALID_MEDIA_KEY');
    }
    existingToReplace = await env.DB
      .prepare('SELECT * FROM media_objects WHERE key = ?')
      .bind(normalizedReplace)
      .first<MediaObjectDbRow>();
    if (existingToReplace && existingToReplace.owner_id !== user.id && user.role !== 'admin') {
      throw new ValidationError('You can only replace media files you uploaded.', 403, 'FORBIDDEN');
    }
  }

  const file = opts.file;
  if (!(file instanceof File)) {
    throw new ValidationError('Please attach a file to upload.', 400, 'MISSING_FILE');
  }
  if (file.size <= 0) {
    throw new ValidationError('The uploaded file is empty.', 400, 'EMPTY_FILE');
  }

  const maxSize = MAX_SIZE_BYTES_BY_PURPOSE[purpose];
  if (file.size > maxSize) {
    const maxMb = Math.round((maxSize / (1024 * 1024)) * 10) / 10;
    throw new ValidationError(
      `File is too large. Maximum allowed size is ${maxMb} MB.`,
      413,
      'FILE_TOO_LARGE',
    );
  }

  const allowedMimes = allowedMimeTypesForPurpose(purpose);
  const declaredMime = normalizeDeclaredMimeType(file.type);
  if (!declaredMime || !allowedMimes.has(declaredMime)) {
    throw new ValidationError(
      purpose === 'claim_proof'
        ? 'Only JPG, PNG, WebP images or PDF documents are allowed.'
        : 'Only JPG, PNG, WebP, or GIF images are allowed.',
      400,
      'UNSUPPORTED_FILE_TYPE',
    );
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const actualByteSize = bytes.byteLength;
  if (actualByteSize <= 0) {
    throw new ValidationError('The uploaded file is empty.', 400, 'EMPTY_FILE');
  }
  if (actualByteSize > maxSize) {
    const maxMb = Math.round((maxSize / (1024 * 1024)) * 10) / 10;
    throw new ValidationError(
      `File is too large. Maximum allowed size is ${maxMb} MB.`,
      413,
      'FILE_TOO_LARGE',
    );
  }

  const magicMime = detectMagicMimeType(bytes);
  if (!magicMime || !allowedMimes.has(magicMime)) {
    throw new ValidationError(
      'File signature validation failed. Upload a genuine image or document matching the allowed types.',
      400,
      'INVALID_FILE_SIGNATURE',
    );
  }
  if (magicMime !== declaredMime) {
    throw new ValidationError(
      'Uploaded file contents do not match the declared file type.',
      400,
      'MEDIA_CONTENT_MISMATCH',
    );
  }

  const visibility = defaultVisibilityForPurpose(purpose);
  const now = Date.now();
  const key = buildUniqueMediaKey({
    purpose,
    visibility,
    ownerId: user.id,
    contentType: magicMime,
    nowMs: now,
  });
  const sha256 = await sha256Hex(buffer);
  const originalFilename = cleanText(file.name, 160) || null;
  const cacheControl =
    visibility === 'private' ? 'private, no-store' : 'public, max-age=31536000, immutable';

  await env.MEDIA_BUCKET.put(key, buffer, {
    httpMetadata: {
      contentType: magicMime,
      cacheControl,
    },
    customMetadata: {
      ownerId: user.id,
      purpose,
      visibility,
    },
  });

  try {
    await env.DB
      .prepare(
        `INSERT INTO media_objects (
          key, owner_id, purpose, entity_type, entity_id, visibility,
          content_type, size_bytes, sha256, original_filename, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        key,
        user.id,
        purpose,
        entityType ?? null,
        entityId ?? null,
        visibility,
        magicMime,
        actualByteSize,
        sha256,
        originalFilename,
        now,
        now,
      )
      .run();
  } catch (err) {
    // Prevent orphaned R2 object if D1 write fails.
    await env.MEDIA_BUCKET.delete(key).catch(() => {});
    throw err;
  }

  const deliveryUrl = buildMediaDeliveryUrl(key, visibility, env.R2_PUBLIC_BASE_URL);

  if (existingToReplace && existingToReplace.key !== key) {
    const oldUrls = candidateUrlsForKey(existingToReplace.key, env.R2_PUBLIC_BASE_URL);
    await rewriteMediaReferences(env.DB, oldUrls, deliveryUrl, now);
    await env.MEDIA_BUCKET.delete(existingToReplace.key).catch(() => {});
    await env.DB.prepare('DELETE FROM media_objects WHERE key = ?').bind(existingToReplace.key).run();
  }

  const row = await env.DB
    .prepare('SELECT * FROM media_objects WHERE key = ?')
    .bind(key)
    .first<MediaObjectDbRow>();

  return row
    ? mapMediaRow(row, env.R2_PUBLIC_BASE_URL)
    : {
        key,
        url: deliveryUrl,
        purpose,
        visibility,
        entityType,
        entityId,
        contentType: magicMime,
        sizeBytes: actualByteSize,
        sha256,
        originalFilename: originalFilename ?? undefined,
        createdAt: now,
        updatedAt: now,
      };
}

export async function replaceMediaByKey(
  env: Bindings,
  user: AuthSessionUser,
  rawTargetKey: string,
  file: File,
): Promise<{ previousKey: string; media: MediaRecord }> {
  const targetKey = normalizeMediaKey(rawTargetKey);
  if (!targetKey) {
    throw new ValidationError('Invalid media object key.', 400, 'INVALID_MEDIA_KEY');
  }

  const existing = await env.DB
    .prepare('SELECT * FROM media_objects WHERE key = ?')
    .bind(targetKey)
    .first<MediaObjectDbRow>();

  if (!existing) {
    throw new ValidationError('Media object was not found.', 404, 'MEDIA_NOT_FOUND');
  }
  if (existing.owner_id !== user.id && user.role !== 'admin') {
    throw new ValidationError('You can only replace your own media files.', 403, 'FORBIDDEN');
  }

  const media = await uploadMedia(env, user, {
    file,
    purpose: existing.purpose,
    entityType: existing.entity_type,
    entityId: existing.entity_id,
    replaceKey: existing.key,
  });

  return { previousKey: existing.key, media };
}

export async function deleteMediaByKey(
  env: Bindings,
  user: AuthSessionUser,
  rawTargetKey: string,
): Promise<{ deleted: true; key: string }> {
  const targetKey = normalizeMediaKey(rawTargetKey);
  if (!targetKey) {
    throw new ValidationError('Invalid media object key.', 400, 'INVALID_MEDIA_KEY');
  }

  const existing = await env.DB
    .prepare('SELECT * FROM media_objects WHERE key = ?')
    .bind(targetKey)
    .first<MediaObjectDbRow>();

  if (existing) {
    if (existing.owner_id !== user.id && user.role !== 'admin') {
      throw new ValidationError('You can only delete your own media files.', 403, 'FORBIDDEN');
    }
  } else {
    const head = await env.MEDIA_BUCKET.head(targetKey);
    if (!head) {
      throw new ValidationError('Media object was not found.', 404, 'MEDIA_NOT_FOUND');
    }
    if (user.role !== 'admin') {
      throw new ValidationError('You can only delete your own media files.', 403, 'FORBIDDEN');
    }
  }

  const now = Date.now();
  const oldUrls = candidateUrlsForKey(targetKey, env.R2_PUBLIC_BASE_URL);
  await rewriteMediaReferences(env.DB, oldUrls, null, now);
  await env.MEDIA_BUCKET.delete(targetKey);
  await env.DB.prepare('DELETE FROM media_objects WHERE key = ?').bind(targetKey).run();

  return { deleted: true, key: targetKey };
}

export async function getAuthorizedMediaObject(
  env: Bindings,
  rawKey: string,
  viewer: AuthSessionUser | null,
): Promise<{
  key: string;
  object: R2ObjectBody;
  isPrivate: boolean;
  contentType: string;
}> {
  const key = normalizeMediaKey(rawKey);
  if (!key) {
    throw new ValidationError('Invalid media object key.', 400, 'INVALID_MEDIA_KEY');
  }

  const record = await env.DB
    .prepare('SELECT key, owner_id, visibility, content_type FROM media_objects WHERE key = ?')
    .bind(key)
    .first<Pick<MediaObjectDbRow, 'key' | 'owner_id' | 'visibility' | 'content_type'>>();

  const isPrivate = record?.visibility === 'private' || key.startsWith('private/');
  if (isPrivate) {
    if (!viewer) {
      throw new ValidationError('Sign in to access this private file.', 401, 'UNAUTHORIZED');
    }
    if (viewer.role !== 'admin' && (!record || record.owner_id !== viewer.id)) {
      throw new ValidationError('You do not have permission to view this private file.', 403, 'FORBIDDEN');
    }
  }

  const object = await env.MEDIA_BUCKET.get(key);
  if (!object) {
    throw new ValidationError('Media object not found.', 404, 'MEDIA_NOT_FOUND');
  }

  const contentType =
    record?.content_type || object.httpMetadata?.contentType || 'application/octet-stream';

  return { key, object, isPrivate, contentType };
}

export async function listMyMedia(
  env: Bindings,
  userId: string,
  purpose?: string | null,
  limit = 100,
): Promise<MediaRecord[]> {
  const safeLimit = Math.min(200, Math.max(1, Math.trunc(limit)));
  const cleanPurpose = cleanText(purpose, 40);
  const res = cleanPurpose
    ? await env.DB
        .prepare(
          'SELECT * FROM media_objects WHERE owner_id = ? AND purpose = ? ORDER BY created_at DESC LIMIT ?',
        )
        .bind(userId, cleanPurpose, safeLimit)
        .all<MediaObjectDbRow>()
    : await env.DB
        .prepare('SELECT * FROM media_objects WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?')
        .bind(userId, safeLimit)
        .all<MediaObjectDbRow>();

  return res.results.map((r) => mapMediaRow(r, env.R2_PUBLIC_BASE_URL));
}

export async function updateUserAvatar(
  env: Bindings,
  user: AuthSessionUser,
  rawImageUrl: unknown,
): Promise<{ image: string | null }> {
  const nextImage =
    rawImageUrl === null || rawImageUrl === undefined || rawImageUrl === ''
      ? null
      : (safeMediaUrl(rawImageUrl, { max: 600, allowPrivate: false }) ??
        (() => {
          throw new ValidationError(
            'Profile photo must be an uploaded image or valid https:// URL.',
            400,
            'INVALID_IMAGE_URL',
          );
        })());

  const currentUser = await env.DB
    .prepare('SELECT image FROM user WHERE id = ?')
    .bind(user.id)
    .first<{ image: string | null }>();

  const now = Date.now();
  await env.DB
    .prepare('UPDATE user SET image = ?, updated_at = ? WHERE id = ?')
    .bind(nextImage, now, user.id)
    .run();

  const nextKey = nextImage ? extractMediaKeyFromUrl(nextImage, env.R2_PUBLIC_BASE_URL) : null;
  if (nextKey) {
    await env.DB
      .prepare(
        `UPDATE media_objects
         SET entity_type = 'user', entity_id = ?, updated_at = ?
         WHERE key = ? AND owner_id = ?`,
      )
      .bind(user.id, now, nextKey, user.id)
      .run();
  }

  const prevKey = currentUser?.image
    ? extractMediaKeyFromUrl(currentUser.image, env.R2_PUBLIC_BASE_URL)
    : null;
  if (prevKey && prevKey !== nextKey) {
    const owned = await env.DB
      .prepare('SELECT key, owner_id FROM media_objects WHERE key = ?')
      .bind(prevKey)
      .first<{ key: string; owner_id: string }>();
    if (owned && (owned.owner_id === user.id || user.role === 'admin')) {
      await env.MEDIA_BUCKET?.delete(prevKey).catch(() => {});
      await env.DB.prepare('DELETE FROM media_objects WHERE key = ?').bind(prevKey).run();
    }
  }

  return { image: nextImage };
}

export async function getUserProfile(
  db: D1Database,
  user: AuthSessionUser,
): Promise<{
  id: string;
  email: string;
  displayName: string;
  photoURL: string;
  emailVerified: boolean;
  role: 'user' | 'admin';
  banned: boolean;
  banReason?: string;
  createdAt: string;
}> {
  const row = await db
    .prepare('SELECT id, email, name, image, email_verified, role, banned, ban_reason, created_at FROM user WHERE id = ?')
    .bind(user.id)
    .first<{
      id: string;
      email: string;
      name: string | null;
      image: string | null;
      email_verified: number;
      role: string | null;
      banned: number;
      ban_reason: string | null;
      created_at: number | null;
    }>();

  if (!row) {
    throw new ValidationError('User profile not found.', 404, 'NOT_FOUND');
  }

  const createdMs = Number(row.created_at);
  const createdAt =
    Number.isFinite(createdMs) && createdMs > 0
      ? new Date(createdMs).toISOString()
      : new Date().toISOString();

  const fallbackName = row.email ? row.email.split('@')[0] : 'Naija Explorer';
  return {
    id: row.id,
    email: row.email,
    displayName: cleanText(row.name || fallbackName, 100) || 'Naija Explorer',
    photoURL: row.image || '',
    emailVerified: Boolean(row.email_verified),
    role: row.role === 'admin' ? 'admin' : 'user',
    banned: Boolean(row.banned),
    banReason: row.ban_reason || undefined,
    createdAt,
  };
}

export async function updateUserProfile(
  db: D1Database,
  user: AuthSessionUser,
  rawInput: Record<string, unknown>,
) {
  const name = cleanText(rawInput.displayName ?? rawInput.name, 100);
  if (name.length < 2) {
    throw new ValidationError('Display name must be at least 2 characters.');
  }

  const now = Date.now();
  await db
    .prepare('UPDATE user SET name = ?, updated_at = ? WHERE id = ?')
    .bind(name, now, user.id)
    .run();

  return getUserProfile(db, user);
}

export async function cleanupMediaUrlsForActor(
  env: Pick<Bindings, 'DB' | 'MEDIA_BUCKET' | 'R2_PUBLIC_BASE_URL'>,
  actor: AuthSessionUser,
  urls: Array<string | null | undefined>,
): Promise<void> {
  if (!env.MEDIA_BUCKET) return;
  const keys = Array.from(
    new Set(
      urls
        .map((u) => extractMediaKeyFromUrl(u, env.R2_PUBLIC_BASE_URL))
        .filter((k): k is string => Boolean(k)),
    ),
  );
  if (keys.length === 0) return;

  for (const key of keys) {
    const row = await env.DB
      .prepare('SELECT key, owner_id FROM media_objects WHERE key = ?')
      .bind(key)
      .first<{ key: string; owner_id: string }>();
    if (!row) continue;
    if (row.owner_id !== actor.id && actor.role !== 'admin') continue;
    await env.MEDIA_BUCKET.delete(key).catch(() => {});
    await env.DB.prepare('DELETE FROM media_objects WHERE key = ?').bind(key).run();
  }
}
