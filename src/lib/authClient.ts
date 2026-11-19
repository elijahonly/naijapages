import { createAuthClient } from 'better-auth/client';

const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

/**
 * Better Auth client communicating with the Cloudflare Worker `/api/auth/*` endpoints.
 * Relies strictly on HTTP-only cookies (`credentials: 'include'`) — never stores
 * passwords or session tokens in localStorage or sessionStorage.
 */
export const authClient = createAuthClient({
  baseURL: configuredBaseUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8787'),
  basePath: '/api/auth',
  fetchOptions: {
    credentials: 'include',
  },
});

export interface AuthProvidersStatus {
  emailPassword: boolean;
  google: boolean;
  requireVerifiedEmail: boolean;
}

export async function fetchAuthProviders(): Promise<AuthProvidersStatus> {
  const endpoint = `${configuredBaseUrl}/api/auth/providers`;
  const res = await fetch(endpoint, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const payload = (await res.json()) as {
    ok?: boolean;
    data?: AuthProvidersStatus;
  };
  if (!payload?.ok || !payload.data) {
    throw new Error('Invalid providers payload');
  }
  return payload.data;
}
