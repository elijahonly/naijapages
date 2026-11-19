/**
 * Client-side Cloudflare R2 media upload, replacement, and deletion helpers.
 * All requests route through the central API client (`/api/media/*`) —
 * R2 credentials never exist in browser code.
 */

import { ApiClientError, apiFetch, apiUpload } from '../lib/apiClient';

export type MediaPurpose =
  | 'avatar'
  | 'business_logo'
  | 'business_photo'
  | 'business_gallery'
  | 'marketplace_image'
  | 'claim_proof'
  | 'general';

export type MediaEntityType = 'user' | 'business' | 'marketplace_item' | 'claim';

export interface UploadedMediaRecord {
  key: string;
  url: string;
  purpose: MediaPurpose;
  visibility: 'public' | 'private';
  entityType?: MediaEntityType;
  entityId?: string;
  contentType: string;
  sizeBytes: number;
  sha256?: string;
  originalFilename?: string;
  createdAt: number;
  updatedAt: number;
}

export const MEDIA_LIMITS_MB: Record<MediaPurpose, number> = {
  avatar: 2,
  business_logo: 2,
  business_photo: 5,
  business_gallery: 5,
  marketplace_image: 5,
  claim_proof: 8,
  general: 5,
};

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_PROOF_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']);

export function extractMediaKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('/api/media/')) {
    const key = trimmed.slice('/api/media/'.length).split(/[?#]/)[0] ?? '';
    return key || null;
  }
  return null;
}

export function validateClientFileForPurpose(file: File, purpose: MediaPurpose): string | null {
  if (!file || file.size <= 0) {
    return 'Please select a non-empty file.';
  }
  const maxMb = MEDIA_LIMITS_MB[purpose] ?? 5;
  if (file.size > maxMb * 1024 * 1024) {
    return `File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum is ${maxMb} MB.`;
  }
  const mime = (file.type || '').toLowerCase();
  const allowed = purpose === 'claim_proof' ? ALLOWED_PROOF_MIMES : ALLOWED_IMAGE_MIMES;
  if (!mime || !allowed.has(mime)) {
    return purpose === 'claim_proof'
      ? 'Only JPG, PNG, WebP images or PDF files are accepted.'
      : 'Only JPG, PNG, WebP, or GIF images are accepted.';
  }
  return null;
}

export async function uploadMediaFile(opts: {
  file: File;
  purpose: MediaPurpose;
  entityType?: MediaEntityType;
  entityId?: string;
  replaceKey?: string | null;
}): Promise<UploadedMediaRecord> {
  const clientErr = validateClientFileForPurpose(opts.file, opts.purpose);
  if (clientErr) {
    throw new ApiClientError('VALIDATION_ERROR', clientErr, 400);
  }

  const form = new FormData();
  form.append('file', opts.file);
  form.append('purpose', opts.purpose);
  if (opts.entityType) form.append('entityType', opts.entityType);
  if (opts.entityId) form.append('entityId', opts.entityId);
  if (opts.replaceKey) form.append('replaceKey', opts.replaceKey);

  const data = await apiUpload<{ media: UploadedMediaRecord }>('/api/media/upload', form);
  return data.media;
}

export async function replaceMediaFile(
  targetKeyOrUrl: string,
  file: File,
  purpose: MediaPurpose = 'general',
): Promise<UploadedMediaRecord> {
  const clientErr = validateClientFileForPurpose(file, purpose);
  if (clientErr) {
    throw new ApiClientError('VALIDATION_ERROR', clientErr, 400);
  }
  const key = extractMediaKeyFromUrl(targetKeyOrUrl) ?? targetKeyOrUrl;
  const form = new FormData();
  form.append('file', file);
  form.append('key', key);

  const data = await apiUpload<{ media: UploadedMediaRecord }>('/api/media/replace', form);
  return data.media;
}

export async function deleteMediaFile(targetKeyOrUrl: string): Promise<void> {
  const key = extractMediaKeyFromUrl(targetKeyOrUrl) ?? targetKeyOrUrl;
  if (!key) return;
  const encodedPath = key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  await apiFetch<{ deleted: boolean }>(`/api/media/${encodedPath}`, {
    method: 'DELETE',
  });
}
