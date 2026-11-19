import { Hono } from 'hono';
import { checkD1Health } from '../lib/db';
import { checkKvHealth } from '../lib/kv';
import { checkR2Health } from '../lib/r2';
import { jsonOk } from '../lib/response';
import type { AppEnv } from '../types';

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get('/health', (c) => {
  return jsonOk(c, {
    service: 'naijapages-worker',
    env: c.env.APP_ENV || 'development',
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

healthRoutes.get('/health/bindings', async (c) => {
  const [d1, r2, kv] = await Promise.all([
    checkD1Health(c.env.DB),
    checkR2Health(c.env.MEDIA_BUCKET),
    checkKvHealth(c.env.RATE_LIMIT_KV),
  ]);

  const healthy = d1.connected && r2.connected && (!kv.configured || kv.connected);
  return jsonOk(
    c,
    {
      service: 'naijapages-worker',
      env: c.env.APP_ENV || 'development',
      healthy,
      bindings: { d1, r2, kv },
    },
    healthy ? 200 : 503,
  );
});
