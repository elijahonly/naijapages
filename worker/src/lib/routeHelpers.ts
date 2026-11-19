import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { jsonError } from './response';
import { ValidationError } from './validation';
import type { AppEnv } from '../types';

export async function readJsonBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ValidationError('Invalid JSON request body.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object.');
  }
  return body as Record<string, unknown>;
}

export function handleRouteError(c: Context<AppEnv>, err: unknown) {
  if (err instanceof ValidationError) {
    const status = (err.status >= 400 && err.status < 600 ? err.status : 400) as ContentfulStatusCode;
    return jsonError(c, status, err.code, err.message);
  }
  console.error('[worker/api]', err instanceof Error ? err.message : err);
  return jsonError(c, 500, 'INTERNAL_ERROR', 'Unexpected server error.');
}

export function parseBoolParam(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

export function parseNumberParam(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
