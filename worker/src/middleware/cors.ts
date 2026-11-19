import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const corsMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const allowed = new Set<string>(parseAllowedOrigins(c.env.CORS_ORIGINS));
  if (c.env.APP_URL?.trim()) allowed.add(c.env.APP_URL.trim().replace(/\/+$/, ''));
  if (c.env.BETTER_AUTH_URL?.trim()) allowed.add(c.env.BETTER_AUTH_URL.trim().replace(/\/+$/, ''));

  const isProd = c.env.APP_ENV === 'production';

  const handler = cors({
    origin: (origin) => {
      if (!origin) return '';
      if (allowed.has(origin)) return origin;
      if (!isProd) {
        try {
          const parsed = new URL(origin);
          if (
            parsed.hostname === 'localhost' ||
            parsed.hostname === '127.0.0.1' ||
            parsed.hostname.endsWith('.run.app')
          ) {
            return origin;
          }
        } catch {
          return '';
        }
      }
      return '';
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Turnstile-Token'],
    credentials: true,
    maxAge: 86400,
  });
  return handler(c, next);
};
