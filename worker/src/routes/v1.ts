import { Hono } from 'hono';
import { jsonError, jsonOk } from '../lib/response';
import { handleRouteError, readJsonBody } from '../lib/routeHelpers';
import { optionalAuthMiddleware, requireActiveMember, requireAuth } from '../middleware/auth';
import {
  fetchMySubmissions,
  submitClaim,
  submitContactMessage,
  submitReport,
  subscribeNewsletter,
} from '../services/directoryService';
import { getUserProfile, updateUserAvatar, updateUserProfile } from '../services/mediaService';
import type { AppEnv } from '../types';
import { adminRoutes } from './admin';
import { directoryRoutes } from './directory';
import { marketplaceRoutes } from './marketplace';

export const v1Routes = new Hono<AppEnv>();

v1Routes.get('/status', (c) => {
  return jsonOk(c, {
    api: 'v1',
    phase: 'phase-5-r2-migrated',
    authMigrated: true,
    dataMigrated: true,
    storageMigrated: true,
    frontendIntegrated: true,
    features: {
      d1: Boolean(c.env.DB),
      r2: Boolean(c.env.MEDIA_BUCKET),
      r2Configured: Boolean(c.env.MEDIA_BUCKET),
      kvRateLimit: Boolean(c.env.RATE_LIMIT_KV),
      turnstileConfigured: Boolean(c.env.TURNSTILE_SECRET_KEY),
      googleOAuthConfigured: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    },
  });
});

v1Routes.all('/auth/*', (c) =>
  jsonError(c, 404, 'MOVED_TO_BETTER_AUTH', 'Authentication endpoints are served under /api/auth/*.'),
);

v1Routes.route('/directory', directoryRoutes);
v1Routes.route('/marketplace', marketplaceRoutes);
v1Routes.route('/admin', adminRoutes);

v1Routes.get('/me/profile', requireAuth, async (c) => {
  try {
    const user = c.get('authUser')!;
    return jsonOk(c, { profile: await getUserProfile(c.env.DB, user) });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

v1Routes.patch('/me/profile', requireActiveMember, async (c) => {
  try {
    const user = c.get('authUser')!;
    const body = await readJsonBody(c);
    return jsonOk(c, { profile: await updateUserProfile(c.env.DB, user, body) });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

v1Routes.get('/me/submissions', requireAuth, async (c) => {
  try {
    const user = c.get('authUser')!;
    return jsonOk(c, await fetchMySubmissions(c.env.DB, user.id));
  } catch (err) {
    return handleRouteError(c, err);
  }
});

v1Routes.put('/me/avatar', requireActiveMember, async (c) => {
  try {
    const user = c.get('authUser')!;
    const body = await readJsonBody(c);
    return jsonOk(c, await updateUserAvatar(c.env, user, body.imageUrl ?? body.image ?? null));
  } catch (err) {
    return handleRouteError(c, err);
  }
});

v1Routes.delete('/me/avatar', requireAuth, async (c) => {
  try {
    const user = c.get('authUser')!;
    return jsonOk(c, await updateUserAvatar(c.env, user, null));
  } catch (err) {
    return handleRouteError(c, err);
  }
});

v1Routes.post('/claims', requireActiveMember, async (c) => {
  try {
    const user = c.get('authUser')!;
    const body = await readJsonBody(c);
    return jsonOk(c, await submitClaim(c.env.DB, user, body, c.env.R2_PUBLIC_BASE_URL), 201);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

v1Routes.post('/reports', requireActiveMember, async (c) => {
  try {
    const user = c.get('authUser')!;
    const body = await readJsonBody(c);
    return jsonOk(c, await submitReport(c.env.DB, user, body), 201);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

v1Routes.post('/contact', optionalAuthMiddleware, async (c) => {
  try {
    const user = c.get('authUser') ?? null;
    const body = await readJsonBody(c);
    return jsonOk(c, await submitContactMessage(c.env.DB, user, body), 201);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

v1Routes.post('/newsletter', async (c) => {
  try {
    const body = await readJsonBody(c);
    return jsonOk(c, await subscribeNewsletter(c.env.DB, body.email, body.source), 201);
  } catch (err) {
    return handleRouteError(c, err);
  }
});
