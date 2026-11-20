import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';
import { adminRecords, createDb, schema, user as userTable } from './db/schema';
import {
  buildPasswordResetEmail,
  buildVerificationEmail,
  sendTransactionalEmail,
  type EmailHook,
} from './lib/email';
import { hashPasswordPbkdf2, verifyPasswordPbkdf2 } from './lib/password';
import { parseAllowedOrigins } from './middleware/cors';
import type { Bindings } from './types';

const DEV_FALLBACK_SECRET = 'naijapages-local-dev-secret-change-in-production-min-32-chars';

export interface CreateAuthOptions {
  request?: Request;
  onSendEmail?: EmailHook;
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function resolveBaseUrl(env: Bindings, request?: Request): string {
  const configured = env.BETTER_AUTH_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  // In non-production, prefer the incoming browser-facing origin (via Vite proxy or Wrangler)
  // so OAuth callbacks and email links match whatever local/preview origin opened the app.
  if (env.APP_ENV !== 'production' && request) {
    const rawHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
    const forwardedHost = rawHost.split(',')[0]?.trim();
    const rawProto = request.headers.get('x-forwarded-proto') || 'http';
    const firstProto = rawProto.split(',')[0]?.trim().toLowerCase();
    const forwardedProto = firstProto === 'https' ? 'https' : 'http';

    if (forwardedHost) {
      try {
        const candidate = new URL(`${forwardedProto}://${forwardedHost}`);
        if (isLocalHostname(candidate.hostname) || candidate.hostname.endsWith('.run.app')) {
          return candidate.origin;
        }
      } catch {
        // fall through to request.url
      }
    }
    try {
      const reqUrl = new URL(request.url);
      if (isLocalHostname(reqUrl.hostname) || reqUrl.hostname.endsWith('.run.app')) {
        return reqUrl.origin;
      }
    } catch {
      // fall through
    }
  }

  return (env.APP_URL?.trim() || 'http://localhost:8787').replace(/\/+$/, '');
}

function resolveTrustedOrigins(env: Bindings, baseUrl: string, request?: Request): string[] {
  const origins = new Set<string>([
    baseUrl,
    ...parseAllowedOrigins(env.CORS_ORIGINS),
  ]);
  if (env.APP_URL?.trim()) origins.add(env.APP_URL.trim().replace(/\/+$/, ''));
  if (env.BETTER_AUTH_URL?.trim()) origins.add(env.BETTER_AUTH_URL.trim().replace(/\/+$/, ''));

  if (env.APP_ENV !== 'production') {
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
    origins.add('http://localhost:8787');
    origins.add('http://127.0.0.1:8787');
    const originHeader = request?.headers.get('origin');
    if (originHeader) {
      try {
        const parsed = new URL(originHeader);
        if (isLocalHostname(parsed.hostname) || parsed.hostname.endsWith('.run.app')) {
          origins.add(parsed.origin);
        }
      } catch {
        // ignore invalid origin header
      }
    }
  }

  return Array.from(origins).filter(Boolean);
}

export function createAuth(env: Bindings, opts: CreateAuthOptions = {}) {
  const isProd = env.APP_ENV === 'production';
  const configuredSecret = env.BETTER_AUTH_SECRET?.trim() || '';
  if (
    isProd &&
    (configuredSecret.length < 32 ||
      configuredSecret.toLowerCase().startsWith('change-me') ||
      configuredSecret === DEV_FALLBACK_SECRET)
  ) {
    throw new Error(
      'BETTER_AUTH_SECRET must be set to a random 32+ character Cloudflare Worker secret in production.',
    );
  }
  const secret = configuredSecret || DEV_FALLBACK_SECRET;

  const db = createDb(env.DB);
  const baseURL = resolveBaseUrl(env, opts.request);
  const appName = env.APP_NAME?.trim() || 'NaijaPages';
  const requireEmailVerification = env.REQUIRE_VERIFIED_EMAIL !== 'false';
  const bootstrapAdminEmail = env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || '';

  const googleClientId = env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const hasGoogle = Boolean(googleClientId && googleClientSecret);

  return betterAuth({
    appName,
    baseURL,
    basePath: '/api/auth',
    secret,
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema,
    }),
    trustedOrigins: resolveTrustedOrigins(env, baseURL, opts.request),
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'user',
          input: false,
        },
        banned: {
          type: 'boolean',
          required: false,
          defaultValue: false,
          input: false,
        },
        banReason: {
          type: 'string',
          required: false,
          input: false,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh daily on active visits
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification,
      autoSignIn: !requireEmailVerification,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: hashPasswordPbkdf2,
        verify: verifyPasswordPbkdf2,
      },
      async sendResetPassword({ user, url, token }) {
        const mail = buildPasswordResetEmail({
          appName,
          to: user.email,
          name: user.name,
          url,
          token,
        });
        await sendTransactionalEmail(env, mail, opts.onSendEmail);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60, // 1 hour
      async sendVerificationEmail({ user, url, token }) {
        const mail = buildVerificationEmail({
          appName,
          to: user.email,
          name: user.name,
          url,
          token,
        });
        await sendTransactionalEmail(env, mail, opts.onSendEmail);
      },
      async beforeEmailVerification(verifiedUser) {
        if (
          bootstrapAdminEmail &&
          verifiedUser.email.trim().toLowerCase() === bootstrapAdminEmail
        ) {
          const now = Date.now();
          await db
            .update(userTable)
            .set({ role: 'admin', updatedAt: new Date(now) })
            .where(eq(userTable.id, verifiedUser.id));
          await db
            .insert(adminRecords)
            .values({
              userId: verifiedUser.id,
              email: verifiedUser.email.trim().toLowerCase(),
              addedBy: null,
              addedAt: now,
            })
            .onConflictDoNothing();
        }
      },
    },
    socialProviders: hasGoogle
      ? {
          google: {
            clientId: googleClientId!,
            clientSecret: googleClientSecret!,
            prompt: 'select_account',
          },
        }
      : undefined,
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google'],
        requireLocalEmailVerified: true,
        allowDifferentEmails: false,
      },
    },
    advanced: {
      useSecureCookies: baseURL.startsWith('https://'),
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      },
    },
    databaseHooks: {
      user: {
        create: {
          async before(newUser) {
            // Only promote at creation time if email is already verified (e.g., Google OAuth).
            // Email/password signups are promoted in afterEmailVerification once ownership is proven.
            const isBootstrapAdmin =
              Boolean(bootstrapAdminEmail) &&
              typeof newUser.email === 'string' &&
              newUser.email.trim().toLowerCase() === bootstrapAdminEmail &&
              Boolean(newUser.emailVerified);

            return {
              data: {
                ...newUser,
                role: isBootstrapAdmin ? 'admin' : 'user',
                banned: false,
              },
            };
          },
          async after(createdUser) {
            if (createdUser.role === 'admin') {
              await db
                .insert(adminRecords)
                .values({
                  userId: createdUser.id,
                  email: createdUser.email.trim().toLowerCase(),
                  addedBy: null,
                  addedAt: Date.now(),
                })
                .onConflictDoNothing();
            }
          },
        },
      },
    },
  });
}
