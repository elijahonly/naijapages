import { Hono, type Context } from 'hono';
import { jsonOk } from '../lib/response';
import { handleRouteError, parseBoolParam, parseNumberParam, readJsonBody } from '../lib/routeHelpers';
import { optionalAuthMiddleware, requireActiveMember, requireAuth } from '../middleware/auth';
import {
  createMarketplaceAd,
  deleteAdByOwner,
  listMarketplaceItems,
} from '../services/marketplaceService';
import type { AppEnv } from '../types';

export const marketplaceRoutes = new Hono<AppEnv>();

async function handleListAds(c: Context<AppEnv>) {
  try {
    const viewer = c.get('authUser') ?? null;
    const sortParam = c.req.query('sort');
    const sort =
      sortParam === 'newest' || sortParam === 'price_asc' || sortParam === 'price_desc'
        ? sortParam
        : undefined;

    const result = await listMarketplaceItems(
      c.env.DB,
      {
        q: c.req.query('q'),
        category: c.req.query('category'),
        state: c.req.query('state'),
        lga: c.req.query('lga'),
        condition: c.req.query('condition'),
        minPrice: parseNumberParam(c.req.query('minPrice')),
        maxPrice: parseNumberParam(c.req.query('maxPrice')),
        negotiableOnly: parseBoolParam(c.req.query('negotiableOnly')),
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
}

marketplaceRoutes.get('/ads', optionalAuthMiddleware, handleListAds);
marketplaceRoutes.get('/items', optionalAuthMiddleware, handleListAds);

marketplaceRoutes.post('/ads', requireActiveMember, async (c) => {
  try {
    const user = c.get('authUser')!;
    const body = await readJsonBody(c);
    const item = await createMarketplaceAd(c.env.DB, user, body, c.env.R2_PUBLIC_BASE_URL);
    return jsonOk(c, { item }, 201);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

marketplaceRoutes.delete('/ads/:id', requireAuth, async (c) => {
  try {
    const user = c.get('authUser')!;
    await deleteAdByOwner(c.env.DB, c.req.param('id'), user, c.env);
    return jsonOk(c, { deleted: true });
  } catch (err) {
    return handleRouteError(c, err);
  }
});
