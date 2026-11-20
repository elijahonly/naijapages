export interface R2HealthResult {
  connected: boolean;
  latencyMs: number;
  error?: string;
}

export type MediaPurpose =
  | 'avatar'
  | 'business_logo'
  | 'business_photo'
  | 'business_gallery'
  | 'marketplace_image'
  | 'claim_proof'
  | 'general';

export type MediaVisibility = 'public' | 'private';

export type MediaEntityType = 'user' | 'business' | 'marketplace_item' | 'claim';

export const MEDIA_PURPOSES: readonly MediaPurpose[] = [
  'avatar',
  'business_logo',
  'business_photo',
  'business_gallery',
  'marketplace_image',
  'claim_proof',
  'general',
] as const;

export const MEDIA_ENTITY_TYPES: readonly MediaEntityType[] = [
  'user',
  'business',
  'marketplace_item',
  'claim',
] as const;

export const MAX_SIZE_BYTES_BY_PURPOSE: Record<MediaPurpose, number> = {
  avatar: 2 * 1024 * 1024, // 2 MB
  business_logo: 2 * 1024 * 1024, // 2 MB
  business_photo: 5 * 1024 * 1024, // 5 MB
  business_gallery: 5 * 1024 * 1024, // 5 MB
  marketplace_image: 5 * 1024 * 1024, // 5 MB
  claim_proof: 8 * 1024 * 1024, // 8 MB
  general: 5 * 1024 * 1024, // 5 MB
};

export const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export const CLAIM_PROOF_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

const PURPOSE_DIRECTORY: Record<MediaPurpose, string> = {
  avatar: 'avatars',
  business_logo: 'businesses/logos',
  business_photo: 'businesses/photos',
  business_gallery: 'businesses/gallery',
  marketplace_image: 'marketplace',
  claim_proof: 'claims',
  general: 'general',
};

const SAFE_MEDIA_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,220}(\.[a-zA-Z0-9]{1,10})?$/;

/**
 * Validates R2 object keys to block path traversal or control characters.
 */
export function normalizeMediaKey(rawKey: string): string | null {
  const trimmed = rawKey.replace(/^\/+/, '').trim();
  if (!trimmed || trimmed.includes('..') || trimmed.includes('//') || trimmed.includes('\\')) {
    return null;
  }
  return SAFE_MEDIA_KEY_RE.test(trimmed) ? trimmed : null;
}

export function normalizeDeclaredMimeType(rawMime: string | undefined | null): string {
  const clean = (rawMime ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (clean === 'image/jpg' || clean === 'image/pjpeg') return 'image/jpeg';
  return clean;
}

export function allowedMimeTypesForPurpose(purpose: MediaPurpose): Set<string> {
  return purpose === 'claim_proof' ? CLAIM_PROOF_MIME_TYPES : IMAGE_MIME_TYPES;
}

export function defaultVisibilityForPurpose(purpose: MediaPurpose): MediaVisibility {
  return purpose === 'claim_proof' ? 'private' : 'public';
}

/**
 * Verifies actual file binary magic bytes so renamed scripts, SVGs, or HTML
 * cannot bypass upload validation.
 */
export function detectMagicMimeType(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  // GIF: GIF87a / GIF89a
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif';
  }

  // PDF: %PDF-
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return 'application/pdf';
  }

  return null;
}

export function extensionForMimeType(mimeType: string): string {
  return MIME_TO_EXTENSION[mimeType] ?? 'bin';
}

export function sanitizeOwnerPathSegment(ownerId: string): string {
  const clean = ownerId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  return clean || 'member';
}

export function buildUniqueMediaKey(opts: {
  purpose: MediaPurpose;
  visibility: MediaVisibility;
  ownerId: string;
  contentType: string;
  nowMs?: number;
}): string {
  const ext = extensionForMimeType(opts.contentType);
  const ts = Math.trunc(opts.nowMs ?? Date.now());
  const ownerSeg = sanitizeOwnerPathSegment(opts.ownerId);
  const folder = PURPOSE_DIRECTORY[opts.purpose];
  const uuid = crypto.randomUUID();
  return `${opts.visibility}/${folder}/${ownerSeg}/${ts}-${uuid}.${ext}`;
}

export function buildMediaDeliveryUrl(
  key: string,
  visibility: MediaVisibility,
  publicBaseUrl?: string | null,
): string {
  if (visibility === 'private' || key.startsWith('private/')) {
    return `/api/media/${key}`;
  }
  const base = (publicBaseUrl ?? '').trim().replace(/\/+$/, '');
  if (base && /^https:\/\/[a-z0-9.-]+/i.test(base)) {
    return `${base}/${key}`;
  }
  return `/api/media/${key}`;
}

export function extractMediaKeyFromUrl(
  rawUrl: string | null | undefined,
  publicBaseUrl?: string | null,
): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/api/media/')) {
    const rest = trimmed.slice('/api/media/'.length).split(/[?#]/)[0] ?? '';
    return normalizeMediaKey(rest);
  }

  const base = (publicBaseUrl ?? '').trim().replace(/\/+$/, '');
  if (base && trimmed.startsWith(`${base}/`)) {
    const rest = trimmed.slice(base.length + 1).split(/[?#]/)[0] ?? '';
    return normalizeMediaKey(rest);
  }

  return null;
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verifies R2 bucket binding responsiveness with a zero-byte prefix list.
 */
export async function checkR2Health(bucket: R2Bucket | undefined): Promise<R2HealthResult> {
  const started = Date.now();
  if (!bucket) {
    return {
      connected: false,
      latencyMs: 0,
      error: 'MEDIA_BUCKET binding is not configured',
    };
  }
  try {
    await bucket.list({ limit: 1 });
    return { connected: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      connected: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : 'R2 check failed',
    };
  }
}
