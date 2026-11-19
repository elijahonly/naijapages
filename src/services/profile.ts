/**
 * User profile service module backed by Worker D1 (`/api/v1/me/profile`, `/api/v1/me/avatar`)
 * and Cloudflare R2 avatar uploads.
 */

import { apiFetch } from '../lib/apiClient';
import { cleanText } from '../lib/security';
import { uploadMediaFile } from './media';

export interface ServerUserProfile {
  id: string;
  email: string;
  displayName: string;
  photoURL: string;
  emailVerified: boolean;
  role: 'user' | 'admin';
  banned: boolean;
  banReason?: string;
  createdAt: string;
}

export async function fetchMyProfile(signal?: AbortSignal): Promise<ServerUserProfile> {
  const res = await apiFetch<{ profile: ServerUserProfile }>('/api/v1/me/profile', { signal });
  return res.profile;
}

export async function updateMyProfile(displayName: string): Promise<ServerUserProfile> {
  const cleaned = cleanText(displayName, 100);
  const res = await apiFetch<{ profile: ServerUserProfile }>('/api/v1/me/profile', {
    method: 'PATCH',
    body: { displayName: cleaned },
  });
  return res.profile;
}

export async function updateMyAvatar(userId: string, file: File): Promise<string> {
  const uploaded = await uploadMediaFile({
    file,
    purpose: 'avatar',
    entityType: 'user',
    entityId: userId,
  });
  const res = await apiFetch<{ image: string | null }>('/api/v1/me/avatar', {
    method: 'PUT',
    body: { imageUrl: uploaded.url },
  });
  return res.image ?? uploaded.url;
}

export async function removeMyAvatar(): Promise<void> {
  await apiFetch<{ image: string | null }>('/api/v1/me/avatar', {
    method: 'DELETE',
  });
}
