import type { MiddlewareHandler } from 'hono';
import { checkRateLimit } from '../lib/kv';
import { jsonError } from '../lib/response';
import type { AppEnv } from '../types';

export function rateLimitMiddleware(options: {
  scope: string;
  maxRequests: number;
  windowSeconds: number;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const ip =
      c.req.header('cf-connecting-ip') ||
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      'local';
    const result = await checkRateLimit(
      c.env.RATE_LIMIT_KV,
      `${options.scope}:${ip}`,
      options.maxRequests,
      options.windowSeconds,
    );

    c.header('X-RateLimit-Remaining', String(result.remaining));
    c.header('X-RateLimit-Reset', String(result.resetAt));

    if (!result.allowed) {
      return jsonError(c, 429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.');
    }

    await next();
  };
}
