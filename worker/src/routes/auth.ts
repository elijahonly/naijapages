import { Hono } from 'hono';
import { createAuth } from '../auth';
import { checkRateLimit } from '../lib/kv';
import { jsonError, jsonOk } from '../lib/response';
import type { AppEnv } from '../types';

export const authRoutes = new Hono<AppEnv>();

const RATE_LIMITED_POST_PATHS = new Set([
  '/api/auth/sign-in/email',
  '/api/auth/sign-up/email',
  '/api/auth/request-password-reset',
  '/api/auth/send-verification-email',
  '/api/auth/reset-password',
]);

authRoutes.get('/providers', (c) => {
  return jsonOk(c, {
    emailPassword: true,
    google: Boolean(c.env.GOOGLE_CLIENT_ID?.trim() && c.env.GOOGLE_CLIENT_SECRET?.trim()),
    requireVerifiedEmail: c.env.REQUIRE_VERIFIED_EMAIL !== 'false',
  });
});

authRoutes.all('/*', async (c) => {
  if (c.req.method === 'POST' && RATE_LIMITED_POST_PATHS.has(c.req.path)) {
    const ip =
      c.req.header('cf-connecting-ip') ||
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    const rl = await checkRateLimit(c.env.RATE_LIMIT_KV, `auth:${c.req.path}:${ip}`, 20, 60);
    c.header('X-RateLimit-Remaining', String(rl.remaining));
    c.header('X-RateLimit-Reset', String(rl.resetAt));
    if (!rl.allowed) {
      return jsonError(c, 429, 'TOO_MANY_REQUESTS', 'Too many authentication attempts. Please wait a minute and try again.');
    }
  }

  const auth = createAuth(c.env, { request: c.req.raw });
  return auth.handler(c.req.raw);
});
