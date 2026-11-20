import { Hono } from 'hono';
import { jsonError } from './lib/response';
import { corsMiddleware } from './middleware/cors';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { mediaRoutes } from './routes/media';
import { v1Routes } from './routes/v1';
import {
  handleDiscoveryQueueBatch,
  handleDiscoveryScheduled,
} from './services/discovery';
import type { AppEnv, Bindings, DiscoveryQueueMessage } from './types';

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Attach a per-request correlation ID and basic hardening headers to API responses.
  app.use('/api/*', async (c, next) => {
    const requestId = c.req.header('cf-ray') || crypto.randomUUID();
    c.set('requestId', requestId);
    await next();
    c.header('X-Request-Id', requestId);
    c.header('X-Content-Type-Options', 'nosniff');
  });

  app.use('/api/*', corsMiddleware);

  // Apply KV-backed rate limiting only to future write/auth paths (never health checks).
  app.use('/api/v1/*', rateLimitMiddleware({ scope: 'api_v1', maxRequests: 120, windowSeconds: 60 }));

  app.route('/api/auth', authRoutes);
  app.route('/api', healthRoutes);
  app.route('/api/media', mediaRoutes);
  app.route('/api/v1', v1Routes);

  app.notFound(async (c) => {
    if (c.req.path.startsWith('/api/')) {
      return jsonError(c, 404, 'NOT_FOUND', `No API route matches ${c.req.method} ${c.req.path}`);
    }
    if (c.env.ASSETS) {
      return c.env.ASSETS.fetch(c.req.raw);
    }
    return c.text('Not Found', 404);
  });

  app.onError((err, c) => {
    console.error('[worker] unhandled error:', err instanceof Error ? err.message : err);
    return jsonError(c, 500, 'INTERNAL_ERROR', 'Unexpected server error.');
  });

  return app;
}

const app = createApp();

const worker: ExportedHandler<Bindings, DiscoveryQueueMessage> = {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  async queue(batch, env, ctx) {
    await handleDiscoveryQueueBatch(batch, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(handleDiscoveryScheduled(controller, env, ctx));
  },
};

export default worker;
