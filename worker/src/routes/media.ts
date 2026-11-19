import { Hono } from 'hono';
import { jsonOk } from '../lib/response';
import { handleRouteError } from '../lib/routeHelpers';
import { ValidationError } from '../lib/validation';
import { optionalAuthMiddleware, requireActiveMember, requireAuth } from '../middleware/auth';
import { rateLimitMiddleware } from '../middleware/rateLimit';
import {
  deleteMediaByKey,
  getAuthorizedMediaObject,
  listMyMedia,
  replaceMediaByKey,
  uploadMedia,
} from '../services/mediaService';
import type { AppEnv } from '../types';

export const mediaRoutes = new Hono<AppEnv>();

const mediaWriteLimiter = rateLimitMiddleware({
  scope: 'api_media_write',
  maxRequests: 60,
  windowSeconds: 60,
});

function readFormString(form: Record<string, string | File | (string | File)[]>, key: string): string | undefined {
  const val = form[key];
  if (typeof val === 'string') return val.trim() || undefined;
  return undefined;
}

function readFormFile(form: Record<string, string | File | (string | File)[]>, key = 'file'): File | null {
  const val = form[key];
  if (val instanceof File) return val;
  if (Array.isArray(val)) {
    const firstFile = val.find((entry): entry is File => entry instanceof File);
    return firstFile ?? null;
  }
  return null;
}

mediaRoutes.get('/my', requireAuth, async (c) => {
  try {
    const user = c.get('authUser')!;
    const items = await listMyMedia(c.env, user.id, c.req.query('purpose'));
    return jsonOk(c, { items });
  } catch (err) {
    return handleRouteError(c, err);
  }
});

mediaRoutes.post('/upload', mediaWriteLimiter, requireActiveMember, async (c) => {
  try {
    const user = c.get('authUser')!;
    const body = await c.req.parseBody();
    const file = readFormFile(body, 'file');
    if (!file) {
      throw new ValidationError('Please select an image or document to upload.', 400, 'MISSING_FILE');
    }

    const media = await uploadMedia(c.env, user, {
      file,
      purpose: readFormString(body, 'purpose'),
      entityType: readFormString(body, 'entityType'),
      entityId: readFormString(body, 'entityId'),
      replaceKey: readFormString(body, 'replaceKey'),
    });

    return jsonOk(c, { media }, 201);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

mediaRoutes.post('/replace', mediaWriteLimiter, requireActiveMember, async (c) => {
  try {
    const user = c.get('authUser')!;
    const body = await c.req.parseBody();
    const file = readFormFile(body, 'file');
    const key = readFormString(body, 'key') || readFormString(body, 'replaceKey');
    if (!key) {
      throw new ValidationError('Missing target media key to replace.', 400, 'INVALID_MEDIA_KEY');
    }
    if (!file) {
      throw new ValidationError('Please select a replacement file to upload.', 400, 'MISSING_FILE');
    }

    const result = await replaceMediaByKey(c.env, user, key, file);
    return jsonOk(c, result);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

mediaRoutes.put('/:key{.+}', mediaWriteLimiter, requireActiveMember, async (c) => {
  try {
    const user = c.get('authUser')!;
    const body = await c.req.parseBody();
    const file = readFormFile(body, 'file');
    if (!file) {
      throw new ValidationError('Please select a replacement file to upload.', 400, 'MISSING_FILE');
    }
    const result = await replaceMediaByKey(c.env, user, c.req.param('key'), file);
    return jsonOk(c, result);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

mediaRoutes.delete('/:key{.+}', mediaWriteLimiter, requireAuth, async (c) => {
  try {
    const user = c.get('authUser')!;
    const result = await deleteMediaByKey(c.env, user, c.req.param('key'));
    return jsonOk(c, result);
  } catch (err) {
    return handleRouteError(c, err);
  }
});

mediaRoutes.get('/:key{.+}', optionalAuthMiddleware, async (c) => {
  try {
    const viewer = c.get('authUser') ?? null;
    const { object, isPrivate, contentType } = await getAuthorizedMediaObject(
      c.env,
      c.req.param('key'),
      viewer,
    );

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('content-type', contentType);
    headers.set('etag', object.httpEtag);
    headers.set('x-content-type-options', 'nosniff');
    headers.set('content-security-policy', "default-src 'none'; sandbox");

    if (isPrivate) {
      headers.set('cache-control', 'private, no-store');
      headers.set('vary', 'Cookie');
    } else {
      headers.set('cache-control', 'public, max-age=31536000, immutable');
    }

    return new Response(object.body, { headers });
  } catch (err) {
    return handleRouteError(c, err);
  }
});
