import { Hono } from 'hono';
import { jsonOk } from '../lib/response';
import { handleRouteError, parseNumberParam, readJsonBody } from '../lib/routeHelpers';
import { requireAdmin } from '../middleware/auth';
import {
  actOnReport,
  approveAd,
  approveBusiness,
  approveClaim,
  banUser,
  deleteAdForever,
  deleteBusinessForever,
  deleteMessage,
  deleteReviewAsAdmin,
  deleteSubscriber,
  editBusinessAsAdmin,
  getAdminOverview,
  getSiteSettings,
  grantAdmin,
  listAdminAds,
  listAdminAuditLog,
  listAdminBusinesses,
  listAdminClaims,
  listAdminMessages,
  listAdminReports,
  listAdminReviews,
  listAdminSubscribers,
  listAdminUsers,
  loadReportTargetFromDb,
  loadUserActivity,
  rejectBusiness,
  rejectClaim,
  removeAd,
  removeBusiness,
  restoreAd,
  restoreBusiness,
  revokeAdmin,
  saveSettings,
  setBusinessVerified,
  setMessageStatus,
  setSeedHidden,
  unbanUser,
} from '../services/adminService';
import type { AppEnv } from '../types';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', requireAdmin);

adminRoutes.get('/overview', async (c) => {
  try {
    return jsonOk(c, await getAdminOverview(c.env.DB));
  } catch (err) {
    return handleRouteError(c, err);
  }
});

// Businesses
adminRoutes.get('/businesses', async (c) => {
  try {
    const items = await listAdminBusinesses(c.env.DB, parseNumberParam(c.req.query('limit')));
    return jsonOk(c, { items });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/businesses/:id/approve', async (c) => {
  try {
    const body = await readJsonBody(c).catch(() => ({} as Record<string, unknown>));
    await approveBusiness(c.env.DB, c.get('authUser')!, c.req.param('id'), Boolean(body.verify));
    return jsonOk(c, { updated: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/businesses/:id/reject', async (c) => {
  try {
    const body = await readJsonBody(c);
    await rejectBusiness(
      c.env.DB,
      c.get('authUser')!,
      c.req.param('id'),
      String(body.note ?? ''),
    );
    return jsonOk(c, { updated: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/businesses/:id/remove', async (c) => {
  try {
    const body = await readJsonBody(c);
    await removeBusiness(
      c.env.DB,
      c.get('authUser')!,
      c.req.param('id'),
      String(body.note ?? ''),
    );
    return jsonOk(c, { updated: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/businesses/:id/restore', async (c) => {
  try {
    await restoreBusiness(c.env.DB, c.get('authUser')!, c.req.param('id'));
    return jsonOk(c, { updated: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/businesses/:id/verify', async (c) => {
  try {
    const body = await readJsonBody(c);
    await setBusinessVerified(
      c.env.DB,
      c.get('authUser')!,
      c.req.param('id'),
      Boolean(body.verified),
    );
    return jsonOk(c, { updated: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.patch('/businesses/:id', async (c) => {
  try {
    const body = await readJsonBody(c);
    await editBusinessAsAdmin(c.env.DB, c.get('authUser')!, c.req.param('id'), body);
    return jsonOk(c, { updated: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.delete('/businesses/:id', async (c) => {
  try {
    await deleteBusinessForever(c.env.DB, c.get('authUser')!, c.req.param('id'), c.env);
    return jsonOk(c, { deleted: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

// Marketplace ads
adminRoutes.get('/marketplace', async (c) => {
  try {
    const items = await listAdminAds(c.env.DB, parseNumberParam(c.req.query('limit')));
    return jsonOk(c, { items });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/marketplace/:id/approve', async (c) => {
  try {
    await approveAd(c.env.DB, c.get('authUser')!, c.req.param('id'));
    return jsonOk(c, { updated: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/marketplace/:id/remove', async (c) => {
  try {
    const body = await readJsonBody(c);
    await removeAd(c.env.DB, c.get('authUser')!, c.req.param('id'), String(body.note ?? ''));
    return jsonOk(c, { updated: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/marketplace/:id/restore', async (c) => {
  try {
    await restoreAd(c.env.DB, c.get('authUser')!, c.req.param('id'));
    return jsonOk(c, { updated: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.delete('/marketplace/:id', async (c) => {
  try {
    await deleteAdForever(c.env.DB, c.get('authUser')!, c.req.param('id'), c.env);
    return jsonOk(c, { deleted: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

// Built-in seed overrides
adminRoutes.put('/overrides', async (c) => {
  try {
    const body = await readJsonBody(c);
    const kind = body.kind === 'marketplace' ? 'marketplace' : 'business';
    await setSeedHidden(
      c.env.DB,
      c.get('authUser')!,
      kind,
      String(body.id ?? ''),
      String(body.title ?? ''),
      Boolean(body.hidden),
    );
    return jsonOk(c, { updated: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

// Reviews
adminRoutes.get('/reviews', async (c) => {
  try {
    const items = await listAdminReviews(c.env.DB, parseNumberParam(c.req.query('limit')));
    return jsonOk(c, { items });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.delete('/reviews/:id', async (c) => {
  try {
    await deleteReviewAsAdmin(c.env.DB, c.get('authUser')!, c.req.param('id'));
    return jsonOk(c, { deleted: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

// Claims
adminRoutes.get('/claims', async (c) => {
  try {
    const items = await listAdminClaims(c.env.DB, parseNumberParam(c.req.query('limit')));
    return jsonOk(c, { items });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/claims/:id/approve', async (c) => {
  try {
    const body = await readJsonBody(c).catch(() => ({} as Record<string, unknown>));
    const res = await approveClaim(
      c.env.DB,
      c.get('authUser')!,
      c.req.param('id'),
      String(body.note ?? ''),
    );
    return jsonOk(c, res);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/claims/:id/reject', async (c) => {
  try {
    const body = await readJsonBody(c);
    await rejectClaim(
      c.env.DB,
      c.get('authUser')!,
      c.req.param('id'),
      String(body.note ?? ''),
    );
    return jsonOk(c, { updated: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

// Reports
adminRoutes.get('/reports', async (c) => {
  try {
    const items = await listAdminReports(c.env.DB, parseNumberParam(c.req.query('limit')));
    return jsonOk(c, { items });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.get('/reports/:id/target', async (c) => {
  try {
    const target = await loadReportTargetFromDb(c.env.DB, c.req.param('id'));
    return jsonOk(c, { target });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/reports/:id/action', async (c) => {
  try {
    const body = await readJsonBody(c);
    const status = body.status === 'dismissed' ? 'dismissed' : 'resolved';
    const banRaw =
      body.banOwner && typeof body.banOwner === 'object'
        ? (body.banOwner as Record<string, unknown>)
        : undefined;
    await actOnReport(c.env.DB, c.get('authUser')!, c.req.param('id'), {
      status,
      note: String(body.note ?? ''),
      removeContent: Boolean(body.removeContent),
      targetKindHint:
        body.targetKindHint === 'community' ||
        body.targetKindHint === 'builtin' ||
        body.targetKindHint === 'missing'
          ? body.targetKindHint
          : undefined,
      targetTitleHint: typeof body.targetTitleHint === 'string' ? body.targetTitleHint : undefined,
      banOwner: banRaw
        ? {
            reason: String(banRaw.reason ?? ''),
            email: typeof banRaw.email === 'string' ? banRaw.email : undefined,
            name: typeof banRaw.name === 'string' ? banRaw.name : undefined,
          }
        : undefined,
    });
    return jsonOk(c, { updated: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

// Users, bans & admins
adminRoutes.get('/users', async (c) => {
  try {
    return jsonOk(c, await listAdminUsers(c.env.DB, parseNumberParam(c.req.query('limit'))));
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.get('/users/:id/activity', async (c) => {
  try {
    return jsonOk(c, await loadUserActivity(c.env.DB, c.req.param('id')));
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/users/:id/ban', async (c) => {
  try {
    const body = await readJsonBody(c);
    const result = await banUser(
      c.env.DB,
      c.get('authUser')!,
      c.req.param('id'),
      String(body.reason ?? ''),
      body.removeContent !== false,
      {
        email: typeof body.email === 'string' ? body.email : undefined,
        displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
      },
    );
    return jsonOk(c, result);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/users/:id/unban', async (c) => {
  try {
    await unbanUser(c.env.DB, c.get('authUser')!, c.req.param('id'));
    return jsonOk(c, { updated: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/users/:id/grant-admin', async (c) => {
  try {
    await grantAdmin(c.env.DB, c.get('authUser')!, c.req.param('id'));
    return jsonOk(c, { updated: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/users/:id/revoke-admin', async (c) => {
  try {
    await revokeAdmin(c.env.DB, c.get('authUser')!, c.req.param('id'));
    return jsonOk(c, { updated: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

// Messages, newsletter, settings, audit
adminRoutes.get('/messages', async (c) => {
  try {
    const items = await listAdminMessages(c.env.DB, parseNumberParam(c.req.query('limit')));
    return jsonOk(c, { items });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.patch('/messages/:id', async (c) => {
  try {
    const body = await readJsonBody(c);
    const status =
      body.status === 'read' || body.status === 'archived' || body.status === 'new'
        ? body.status
        : 'read';
    await setMessageStatus(c.env.DB, c.req.param('id'), status);
    return jsonOk(c, { updated: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.delete('/messages/:id', async (c) => {
  try {
    await deleteMessage(c.env.DB, c.get('authUser')!, c.req.param('id'));
    return jsonOk(c, { deleted: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.get('/subscribers', async (c) => {
  try {
    const items = await listAdminSubscribers(c.env.DB, parseNumberParam(c.req.query('limit')));
    return jsonOk(c, { items });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.delete('/subscribers/:email', async (c) => {
  try {
    await deleteSubscriber(c.env.DB, c.get('authUser')!, decodeURIComponent(c.req.param('email')));
    return jsonOk(c, { deleted: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.get('/settings', async (c) => {
  try {
    return jsonOk(c, { settings: await getSiteSettings(c.env.DB) });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.put('/settings', async (c) => {
  try {
    const body = await readJsonBody(c);
    const settings = await saveSettings(c.env.DB, c.get('authUser')!, body);
    return jsonOk(c, { settings });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.get('/audit', async (c) => {
  try {
    const items = await listAdminAuditLog(c.env.DB, parseNumberParam(c.req.query('limit')));
    return jsonOk(c, { items });
  } catch (err) {
    return handleRouteError(c, err);
  }
});
