import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  requestId?: string;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: string;
    message: string;
  };
  requestId?: string;
}

export function jsonOk<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  const requestId = c.get('requestId') as string | undefined;
  return c.json<ApiSuccess<T>>({ ok: true, data, requestId }, status);
}

export function jsonError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
) {
  const requestId = c.get('requestId') as string | undefined;
  return c.json<ApiFailure>({ ok: false, error: { code, message }, requestId }, status);
}
