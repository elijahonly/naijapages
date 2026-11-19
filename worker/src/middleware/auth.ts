import type { Context, MiddlewareHandler } from 'hono';
import { createAuth } from '../auth';
import { jsonError } from '../lib/response';
import type { AppEnv, AuthSessionUser } from '../types';

interface DbUserSecurityRow {
  id: string;
  email: string;
  name: string;
  email_verified: number;
  role: string;
  banned: number;
  ban_reason: string | null;
  admin_record_id: string | null;
  ban_record_reason: string | null;
}

export async function resolveAuthSession(c: Context<AppEnv>): Promise<AuthSessionUser | null> {
  const existing = c.get('authUser');
  if (existing !== undefined) {
    return existing;
  }

  let sessionResult: { user?: { id?: string } } | null = null;
  try {
    const auth = createAuth(c.env, { request: c.req.raw });
    sessionResult = (await auth.api.getSession({
      headers: c.req.raw.headers,
      query: { disableCookieCache: true },
    })) as { user?: { id?: string } } | null;
  } catch {
    c.set('authUser', null);
    return null;
  }

  const userId = sessionResult?.user?.id;
  if (!userId) {
    c.set('authUser', null);
    return null;
  }

  // Always read authoritative role/ban/verification flags directly from D1.
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.email_verified, u.role, u.banned, u.ban_reason,
            ar.user_id AS admin_record_id,
            ub.reason AS ban_record_reason
     FROM user u
     LEFT JOIN admin_records ar ON ar.user_id = u.id
     LEFT JOIN user_bans ub ON ub.user_id = u.id
     WHERE u.id = ?`,
  )
    .bind(userId)
    .first<DbUserSecurityRow>();

  if (!row) {
    c.set('authUser', null);
    return null;
  }

  const authUser: AuthSessionUser = {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: row.email_verified === 1,
    role: row.role === 'admin' || row.admin_record_id !== null ? 'admin' : 'user',
    banned: row.banned === 1 || row.ban_record_reason !== null,
    banReason: row.ban_reason || row.ban_record_reason || undefined,
  };

  c.set('authUser', authUser);
  return authUser;
}

export const optionalAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  await resolveAuthSession(c);
  await next();
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await resolveAuthSession(c);
  if (!user) {
    return jsonError(c, 401, 'UNAUTHORIZED', 'Please sign in and try again.');
  }
  await next();
};

export const requireActiveMember: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await resolveAuthSession(c);
  if (!user) {
    return jsonError(c, 401, 'UNAUTHORIZED', 'Please sign in and try again.');
  }
  if (user.banned) {
    return jsonError(
      c,
      403,
      'ACCOUNT_BANNED',
      'Your account has been suspended and cannot perform this action.',
    );
  }
  if (c.env.REQUIRE_VERIFIED_EMAIL !== 'false' && !user.emailVerified) {
    return jsonError(
      c,
      403,
      'EMAIL_NOT_VERIFIED',
      'Please verify your email address before continuing.',
    );
  }
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await resolveAuthSession(c);
  if (!user) {
    return jsonError(c, 401, 'UNAUTHORIZED', 'Please sign in and try again.');
  }
  if (user.banned || user.role !== 'admin') {
    return jsonError(c, 403, 'FORBIDDEN', 'Administrator access is required.');
  }
  await next();
};
