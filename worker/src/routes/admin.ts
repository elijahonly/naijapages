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
import {
  actOnAdminMonitoringRecord,
  decideAdminReviewQueueItem,
  getAdminDiscoveryOverview,
  getDiscoveryBotSettings,
  listAdminBotHistory,
  listAdminDiscoveryJobs,
  listAdminMonitoringRecords,
  listAdminReviewQueue,
  retryAdminDiscoveryJob,
  runManualAdminDiscoveryJob,
  saveAdminDiscoverySettings,
  updateAdminDiscoverySource,
  type AdminReviewAction,
} from '../services/discovery';
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

// ---------------------------------------------------------------------------
// Business Intelligence: Automated Discovery, Verification & Monitoring Bot
// ---------------------------------------------------------------------------

adminRoutes.get('/discovery/overview', async (c) => {
  try {
    return jsonOk(c, await getAdminDiscoveryOverview(c.env.DB));
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.get('/discovery/review-queue', async (c) => {
  try {
    const status = c.req.query('status') || 'pending';
    const limit = parseNumberParam(c.req.query('limit'));
    const items = await listAdminReviewQueue(c.env.DB, { status, limit });
    return jsonOk(c, { items });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

const ALLOWED_REVIEW_ACTIONS = new Set<AdminReviewAction>([
  'approve_publish',
  'reject',
  'merge_duplicate',
  'keep_separate_branch',
  'edit_candidate',
  'request_verification',
  'confirm_relocation',
  'confirm_closure',
  'restore_archived',
]);

adminRoutes.post('/discovery/review-queue/:id/decision', async (c) => {
  try {
    const body = await readJsonBody(c);
    const rawAction = String(body.action ?? '') as AdminReviewAction;
    if (!ALLOWED_REVIEW_ACTIONS.has(rawAction)) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid review action.' } },
        400,
      );
    }
    const edits =
      body.edits && typeof body.edits === 'object' && !Array.isArray(body.edits)
        ? (body.edits as Record<string, string>)
        : undefined;
    const res = await decideAdminReviewQueueItem(c.env.DB, c.get('authUser')!, c.req.param('id'), {
      action: rawAction,
      note: typeof body.note === 'string' ? body.note : undefined,
      edits,
    });
    return jsonOk(c, res);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.patch('/discovery/sources/:id', async (c) => {
  try {
    const body = await readJsonBody(c);
    const allowedPerms = ['pending_review', 'approved', 'restricted', 'rejected', 'revoked'];
    const permissionStatus =
      typeof body.permissionStatus === 'string' && allowedPerms.includes(body.permissionStatus)
        ? (body.permissionStatus as
            | 'pending_review'
            | 'approved'
            | 'restricted'
            | 'rejected'
            | 'revoked')
        : undefined;
    const res = await updateAdminDiscoverySource(c.env.DB, c.get('authUser')!, c.req.param('id'), {
      permissionStatus,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      rateLimitPerMinute:
        body.rateLimitPerMinute !== undefined ? Number(body.rateLimitPerMinute) : undefined,
      resetCircuitBreaker: Boolean(body.resetCircuitBreaker),
    });
    return jsonOk(c, res);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.get('/discovery/jobs', async (c) => {
  try {
    const items = await listAdminDiscoveryJobs(c.env.DB, parseNumberParam(c.req.query('limit')));
    return jsonOk(c, { items });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/discovery/jobs/run', async (c) => {
  try {
    const body = await readJsonBody(c);
    const res = await runManualAdminDiscoveryJob(
      c.env.DB,
      c.env.DISCOVERY_QUEUE,
      c.get('authUser')!,
      {
        sourceId: String(body.sourceId ?? ''),
        state: String(body.state ?? ''),
        lga: typeof body.lga === 'string' ? body.lga : undefined,
        category: typeof body.category === 'string' ? body.category : undefined,
        maxResults: body.maxResults !== undefined ? Number(body.maxResults) : undefined,
        endpointUrl: typeof body.endpointUrl === 'string' ? body.endpointUrl : undefined,
      },
    );
    return jsonOk(c, res, 201);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/discovery/jobs/:id/retry', async (c) => {
  try {
    const res = await retryAdminDiscoveryJob(
      c.env.DB,
      c.env.DISCOVERY_QUEUE,
      c.get('authUser')!,
      c.req.param('id'),
    );
    return jsonOk(c, res);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.get('/discovery/monitoring', async (c) => {
  try {
    const items = await listAdminMonitoringRecords(
      c.env.DB,
      parseNumberParam(c.req.query('limit')),
    );
    return jsonOk(c, { items });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.post('/discovery/monitoring/:id/action', async (c) => {
  try {
    const body = await readJsonBody(c);
    const action = String(body.action ?? '');
    if (
      action !== 'confirm_closure' &&
      action !== 'confirm_relocation' &&
      action !== 'restore_archived' &&
      action !== 'mark_healthy'
    ) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid monitoring action.' } },
        400,
      );
    }
    const res = await actOnAdminMonitoringRecord(
      c.env.DB,
      c.get('authUser')!,
      c.req.param('id'),
      action,
      typeof body.note === 'string' ? body.note : undefined,
    );
    return jsonOk(c, res);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.get('/discovery/settings', async (c) => {
  try {
    return jsonOk(c, { settings: await getDiscoveryBotSettings(c.env.DB) });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.put('/discovery/settings', async (c) => {
  try {
    const body = await readJsonBody(c);
    const settings = await saveAdminDiscoverySettings(c.env.DB, c.get('authUser')!, {
      globalPaused: typeof body.globalPaused === 'boolean' ? body.globalPaused : undefined,
      discoveryPaused: typeof body.discoveryPaused === 'boolean' ? body.discoveryPaused : undefined,
      monitoringPaused:
        typeof body.monitoringPaused === 'boolean' ? body.monitoringPaused : undefined,
      dailyJobLimit: body.dailyJobLimit !== undefined ? Number(body.dailyJobLimit) : undefined,
      maxBatchSize: body.maxBatchSize !== undefined ? Number(body.maxBatchSize) : undefined,
      autoPublishMinConfidence:
        body.autoPublishMinConfidence !== undefined
          ? Number(body.autoPublishMinConfidence)
          : undefined,
      autoPublishMinSources:
        body.autoPublishMinSources !== undefined ? Number(body.autoPublishMinSources) : undefined,
      reviewMinConfidence:
        body.reviewMinConfidence !== undefined ? Number(body.reviewMinConfidence) : undefined,
      closureConfirmThreshold:
        body.closureConfirmThreshold !== undefined
          ? Number(body.closureConfirmThreshold)
          : undefined,
      monitoringDefaultDays:
        body.monitoringDefaultDays !== undefined ? Number(body.monitoringDefaultDays) : undefined,
      aiExtractionEnabled:
        typeof body.aiExtractionEnabled === 'boolean' ? body.aiExtractionEnabled : undefined,
      aiDailyBudgetCalls:
        body.aiDailyBudgetCalls !== undefined ? Number(body.aiDailyBudgetCalls) : undefined,
    });
    return jsonOk(c, { settings });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

adminRoutes.get('/discovery/history', async (c) => {
  try {
    const items = await listAdminBotHistory(c.env.DB, parseNumberParam(c.req.query('limit')));
    return jsonOk(c, { items });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

