/**
 * Central Worker API client for Cloudflare D1 & R2 endpoints (`/api/v1/*`, `/api/media/*`).
 * Always sends credentials (HTTP-only session cookies), emits auth lifecycle events
 * when sessions expire (`401`) or accounts are suspended (`403 ACCOUNT_BANNED`),
 * and throws structured `ApiClientError` instances.
 */

export const DATA_REFRESH_EVENT = 'naijapages:data-refresh';
export const ADMIN_DATA_EVENT = 'naijapages:admin-refresh';
export const AUTH_EXPIRED_EVENT = 'naijapages:auth-expired';
export const ACCOUNT_BANNED_EVENT = 'naijapages:account-banned';

export function emitDataRefresh(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DATA_REFRESH_EVENT));
  }
}

export function emitAdminRefresh(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ADMIN_DATA_EVENT));
  }
}

function dispatchAuthSideEffects(status: number, code: string, message: string): void {
  if (typeof window === 'undefined') return;
  if (status === 401 || code === 'UNAUTHORIZED') {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { message } }));
  } else if (status === 403 && code === 'ACCOUNT_BANNED') {
    window.dispatchEvent(new CustomEvent(ACCOUNT_BANNED_EVENT, { detail: { message } }));
  }
}

export class ApiClientError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function getApiBase(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const configured = env?.VITE_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return '';
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBase()}${normalized}`;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

async function parseApiResponse<T>(res: Response): Promise<T> {
  const rawText = await res.text();
  let parsed: Envelope<T> | null = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText) as Envelope<T>;
    } catch {
      parsed = null;
    }
  }

  if (!res.ok || !parsed?.ok) {
    const code =
      parsed?.error?.code ||
      (res.status === 401 ? 'UNAUTHORIZED' : res.status === 403 ? 'FORBIDDEN' : 'REQUEST_FAILED');
    const message =
      parsed?.error?.message ||
      (res.status >= 500
        ? 'The server ran into a problem. Please try again shortly.'
        : 'Request failed. Please check your input and try again.');
    dispatchAuthSideEffects(res.status, code, message);
    throw new ApiClientError(code, message, res.status, parsed?.error?.details);
  }

  return parsed.data as T;
}

export async function apiFetch<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  let body: string | undefined;

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: options.method ?? (body !== undefined ? 'POST' : 'GET'),
      credentials: 'include',
      headers,
      body,
      signal: options.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err;
    throw new ApiClientError(
      'AUTH_BACKEND_UNAVAILABLE',
      'Unable to reach the NaijaPages server. Please check your connection and try again.',
      503,
    );
  }

  return parseApiResponse<T>(res);
}

export async function apiUpload<T>(
  path: string,
  formData: FormData,
  options: {
    method?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: options.method ?? 'POST',
      credentials: 'include',
      body: formData,
      signal: options.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err;
    throw new ApiClientError(
      'AUTH_BACKEND_UNAVAILABLE',
      'Unable to reach the NaijaPages media service. Please check your connection and try again.',
      503,
    );
  }

  return parseApiResponse<T>(res);
}
