import { Hono } from 'hono';
import { jsonOk } from '../lib/response';
import { handleRouteError, parseBoolParam, parseNumberParam, readJsonBody } from '../lib/routeHelpers';
import { optionalAuthMiddleware, requireActiveMember, requireAuth } from '../middleware/auth';
import {
  addFavourite,
  createBusiness,
  createReview,
  deleteBusinessByOwner,
  deleteReviewByAuthorOrAdmin,
  getBusinessById,
  getPublicBootstrap,
  listBusinesses,
  listCategories,
  listFavourites,
  listReviews,
  removeFavourite,
  syncFavourites,
  updateBusinessByOwner,
} from '../services/directoryService';
import type { AppEnv } from '../types';

export const directoryRoutes = new Hono<AppEnv>();

directoryRoutes.get('/bootstrap', async (c) => {
  try {
    const data = await getPublicBootstrap(c.env.DB);
    return jsonOk(c, data);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

directoryRoutes.get('/categories', async (c) => {
  try {
    const rawKind = c.req.query('kind');
    const kind =
      rawKind === 'directory' || rawKind === 'marketplace' ? rawKind : undefined;
    const items = await listCategories(c.env.DB, kind);
    return jsonOk(c, { items });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

directoryRoutes.get('/businesses', optionalAuthMiddleware, async (c) => {
  try {
    const viewer = c.get('authUser') ?? null;
    const sortParam = c.req.query('sort');
    const sort =
      sortParam === 'rating' ||
      sortParam === 'newest' ||
      sortParam === 'reviews' ||
      sortParam === 'verified' ||
      sortParam === 'name'
        ? sortParam
        : undefined;

    const result = await listBusinesses(
      c.env.DB,
      {
        q: c.req.query('q'),
        category: c.req.query('category'),
        state: c.req.query('state'),
        lga: c.req.query('lga'),
        zone: c.req.query('zone'),
        verifiedOnly: parseBoolParam(c.req.query('verifiedOnly')),
        whatsappOnly: parseBoolParam(c.req.query('whatsappOnly')),
        minRating: parseNumberParam(c.req.query('minRating')),
        ownerId: c.req.query('ownerId'),
        status: c.req.query('status'),
        sort,
        page: parseNumberParam(c.req.query('page')),
        pageSize: parseNumberParam(c.req.query('pageSize')),
      },
      viewer,
    );
    return jsonOk(c, result);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

directoryRoutes.get('/businesses/:id', optionalAuthMiddleware, async (c) => {
  try {
    const viewer = c.get('authUser') ?? null;
    const item = await getBusinessById(c.env.DB, c.req.param('id'), viewer);
    if (!item) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Business listing was not found.' } },
        404,
      );
    }
    return jsonOk(c, { item });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

directoryRoutes.post('/businesses', requireActiveMember, async (c) => {
  try {
    const user = c.get('authUser')!;
    const body = await readJsonBody(c);
    const item = await createBusiness(c.env.DB, user, body, c.env.R2_PUBLIC_BASE_URL);
    return jsonOk(c, { item }, 201);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

directoryRoutes.patch('/businesses/:id', requireActiveMember, async (c) => {
  try {
    const user = c.get('authUser')!;
    const body = await readJsonBody(c);
    const item = await updateBusinessByOwner(c.env.DB, c.req.param('id'), user, body, c.env);
    return jsonOk(c, { item });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

directoryRoutes.delete('/businesses/:id', requireAuth, async (c) => {
  try {
    const user = c.get('authUser')!;
    await deleteBusinessByOwner(c.env.DB, c.req.param('id'), user, c.env);
    return jsonOk(c, { deleted: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

directoryRoutes.get('/businesses/:id/reviews', async (c) => {
  try {
    const result = await listReviews(
      c.env.DB,
      c.req.param('id'),
      parseNumberParam(c.req.query('page')),
      parseNumberParam(c.req.query('pageSize')),
    );
    return jsonOk(c, result);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

directoryRoutes.post('/businesses/:id/reviews', requireActiveMember, async (c) => {
  try {
    const user = c.get('authUser')!;
    const body = await readJsonBody(c);
    const item = await createReview(c.env.DB, user, c.req.param('id'), body);
    return jsonOk(c, { item }, 201);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

directoryRoutes.delete('/reviews/:id', requireAuth, async (c) => {
  try {
    const user = c.get('authUser')!;
    await deleteReviewByAuthorOrAdmin(c.env.DB, c.req.param('id'), user);
    return jsonOk(c, { deleted: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

directoryRoutes.get('/favourites', requireAuth, async (c) => {
  try {
    const user = c.get('authUser')!;
    const businessIds = await listFavourites(c.env.DB, user.id);
    return jsonOk(c, { businessIds });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

directoryRoutes.post('/favourites/sync', requireAuth, async (c) => {
  try {
    const user = c.get('authUser')!;
    const body = await readJsonBody(c);
    const ids = Array.isArray(body.businessIds) ? body.businessIds : [];
    const businessIds = await syncFavourites(c.env.DB, user.id, ids);
    return jsonOk(c, { businessIds });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

directoryRoutes.put('/favourites/:businessId', requireAuth, async (c) => {
  try {
    const user = c.get('authUser')!;
    const businessIds = await addFavourite(c.env.DB, user.id, c.req.param('businessId'));
    return jsonOk(c, { businessIds });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

directoryRoutes.delete('/favourites/:businessId', requireAuth, async (c) => {
  try {
    const user = c.get('authUser')!;
    const businessIds = await removeFavourite(c.env.DB, user.id, c.req.param('businessId'));
    return jsonOk(c, { businessIds });
  } catch (err) {
    return handleRouteError(c, err);
  }
});
