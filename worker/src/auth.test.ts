import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { createAuth } from './auth';
import { buildPasswordResetEmail, buildVerificationEmail, type OutboundEmail } from './lib/email';
import { hashPasswordPbkdf2, verifyPasswordPbkdf2 } from './lib/password';
import type { Bindings } from './types';

const MIGRATION_SQLS = [
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0001_initial_schema.sql'), 'utf8'),
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0002_phase4_relational_data.sql'), 'utf8'),
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0003_phase5_r2_media.sql'), 'utf8'),
];

async function setupD1Env(overrides: Partial<Bindings> = {}) {
  const proxy = await getPlatformProxy<Bindings>({ persist: false });
  // Strip SQL comments and PRAGMA before running statements via D1 exec/batch.
  for (const sql of MIGRATION_SQLS) {
    const statements = sql
      .split(';')
      .map((s) =>
        s
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('--'))
          .join('\n')
          .trim(),
      )
      .filter((s) => s && !/^PRAGMA/i.test(s));

    for (const stmt of statements) {
      await proxy.env.DB.prepare(stmt).run();
    }
  }

  const env: Bindings = {
    ...proxy.env,
    APP_ENV: 'development',
    APP_NAME: 'NaijaPages',
    APP_URL: 'http://localhost:8787',
    BETTER_AUTH_URL: 'http://localhost:8787',
    BETTER_AUTH_SECRET: 'test-better-auth-secret-with-more-than-32-bytes',
    CORS_ORIGINS: 'http://localhost:3000,http://localhost:8787',
    REQUIRE_VERIFIED_EMAIL: 'true',
    ...overrides,
  };

  return {
    env,
    dispose: () => proxy.dispose(),
  };
}

function extractCookies(headers: Headers): string {
  const rawList =
    typeof (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [];
  if (rawList.length > 0) {
    return rawList
      .map((entry) => entry.split(';')[0]?.trim())
      .filter((kv) => kv && !kv.endsWith('='))
      .join('; ');
  }
  const single = headers.get('set-cookie');
  if (!single) return '';
  return single.split(';')[0]?.trim() || '';
}

function getSetCookieHeaders(headers: Headers): string[] {
  if (typeof (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function') {
    return (headers as unknown as { getSetCookie: () => string[] }).getSetCookie();
  }
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function makeFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

test('PBKDF2 password hashing never stores plaintext and verifies safely', async () => {
  const hash1 = await hashPasswordPbkdf2('NaijaPass123!');
  const hash2 = await hashPasswordPbkdf2('NaijaPass123!');
  assert.ok(hash1.startsWith('pbkdf2_sha256$100000$'));
  assert.notEqual(hash1, hash2);
  assert.ok(!hash1.includes('NaijaPass123!'));

  assert.equal(await verifyPasswordPbkdf2({ hash: hash1, password: 'NaijaPass123!' }), true);
  assert.equal(await verifyPasswordPbkdf2({ hash: hash1, password: 'WrongPassword1' }), false);
  assert.equal(await verifyPasswordPbkdf2({ hash: 'invalid-hash', password: 'NaijaPass123!' }), false);
});

test('Email templates escape HTML and embed verification/reset links', () => {
  const verify = buildVerificationEmail({
    appName: 'NaijaPages',
    to: 'ada@example.com',
    name: '<script>Ada</script>',
    url: 'http://localhost:8787/api/auth/verify-email?token=abc',
    token: 'abc',
  });
  assert.ok(verify.html.includes('&lt;script&gt;Ada&lt;/script&gt;'));
  assert.ok(!verify.html.includes('<script>Ada'));
  assert.ok(verify.text.includes('http://localhost:8787/api/auth/verify-email?token=abc'));

  const reset = buildPasswordResetEmail({
    appName: 'NaijaPages',
    to: 'ada@example.com',
    name: 'Ada',
    url: 'http://localhost:8787/api/auth/reset-password/tok123',
    token: 'tok123',
  });
  assert.ok(reset.subject.includes('Reset your NaijaPages password'));
  assert.ok(reset.text.includes('tok123'));
});

test('Better Auth end-to-end: signup, verification gate, resend, login, session persistence, password reset, logout', async () => {
  const sentEmails: OutboundEmail[] = [];
  const { env, dispose } = await setupD1Env({
    BOOTSTRAP_ADMIN_EMAIL: 'founder@naijapages.ng',
  });

  try {
    const auth = createAuth(env, {
      onSendEmail: (mail) => {
        sentEmails.push(mail);
      },
    });

    // 1. Register email/password account
    const signUpRes = await auth.handler(
      new Request('http://localhost:8787/api/auth/sign-up/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:8787',
        },
        body: JSON.stringify({
          email: 'founder@naijapages.ng',
          password: 'Password123',
          name: 'Adaeze Founder',
          callbackURL: 'http://localhost:8787/?auth=verified',
        }),
      }),
    );
    assert.equal(signUpRes.status, 200);
    const signUpData = (await signUpRes.json()) as { token: string | null; user: { id: string; emailVerified: boolean } };
    assert.equal(signUpData.user.emailVerified, false);
    assert.equal(signUpData.token, null);

    // Password in D1 account table must be hashed, never plaintext
    const acctRow = await env.DB.prepare('SELECT password FROM account WHERE user_id = ?')
      .bind(signUpData.user.id)
      .first<{ password: string }>();
    assert.ok(acctRow?.password?.startsWith('pbkdf2_sha256$100000$'));

    // Verification email was dispatched
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].kind, 'verification');

    // 2. Unverified login is rejected with 403 EMAIL_NOT_VERIFIED
    const unverifiedLoginRes = await auth.handler(
      new Request('http://localhost:8787/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:8787',
        },
        body: JSON.stringify({
          email: 'founder@naijapages.ng',
          password: 'Password123',
        }),
      }),
    );
    assert.equal(unverifiedLoginRes.status, 403);
    const unverifiedErr = (await unverifiedLoginRes.json()) as { code?: string };
    assert.equal(unverifiedErr.code, 'EMAIL_NOT_VERIFIED');

    // 3. Resend verification email
    const resendRes = await auth.handler(
      new Request('http://localhost:8787/api/auth/send-verification-email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:8787',
        },
        body: JSON.stringify({
          email: 'founder@naijapages.ng',
          callbackURL: 'http://localhost:8787/?auth=verified',
        }),
      }),
    );
    assert.equal(resendRes.status, 200);
    const latestVerifyEmail = sentEmails.filter((e) => e.kind === 'verification').at(-1);
    assert.ok(latestVerifyEmail);

    // 4. Verify email link sets HTTP-only cookie, marks verified, and promotes bootstrap admin
    const verifyRes = await auth.handler(
      new Request(latestVerifyEmail.url, { method: 'GET' }),
    );
    assert.equal(verifyRes.status, 302);
    const setCookies = getSetCookieHeaders(verifyRes.headers);
    assert.ok(setCookies.some((c) => /HttpOnly/i.test(c) && /SameSite=Lax/i.test(c)));
    const sessionCookie = extractCookies(verifyRes.headers);
    assert.ok(sessionCookie.includes('better-auth.session_token='));

    // 5. Session persists across requests when cookie is sent
    const sessionRes = await auth.handler(
      new Request('http://localhost:8787/api/auth/get-session', {
        headers: { cookie: sessionCookie },
      }),
    );
    assert.equal(sessionRes.status, 200);
    const sessionBody = (await sessionRes.json()) as {
      user: { email: string; emailVerified: boolean; role: string };
      session: { token: string };
    };
    assert.equal(sessionBody.user.email, 'founder@naijapages.ng');
    assert.equal(sessionBody.user.emailVerified, true);
    assert.equal(sessionBody.user.role, 'admin');

    const adminRec = await env.DB.prepare('SELECT user_id, email FROM admin_records WHERE email = ?')
      .bind('founder@naijapages.ng')
      .first<{ user_id: string; email: string }>();
    assert.equal(adminRec?.email, 'founder@naijapages.ng');

    // 6. Password reset request -> callback redirect -> confirm new password -> old session revoked
    const forgotRes = await auth.handler(
      new Request('http://localhost:8787/api/auth/request-password-reset', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:8787',
        },
        body: JSON.stringify({
          email: 'founder@naijapages.ng',
          redirectTo: 'http://localhost:8787/?auth=reset-password',
        }),
      }),
    );
    assert.equal(forgotRes.status, 200);
    const resetMail = sentEmails.find((e) => e.kind === 'password-reset');
    assert.ok(resetMail);

    const resetCallbackRes = await auth.handler(new Request(resetMail.url, { method: 'GET' }));
    assert.equal(resetCallbackRes.status, 302);
    const redirectLocation = resetCallbackRes.headers.get('location') || '';
    const resetToken = new URL(redirectLocation).searchParams.get('token');
    assert.ok(resetToken);

    const resetConfirmRes = await auth.handler(
      new Request('http://localhost:8787/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:8787',
        },
        body: JSON.stringify({
          token: resetToken,
          newPassword: 'NewPassword456',
        }),
      }),
    );
    assert.equal(resetConfirmRes.status, 200);

    // Prior session must be invalidated after password reset
    const oldSessionAfterReset = await auth.handler(
      new Request('http://localhost:8787/api/auth/get-session', {
        headers: { cookie: sessionCookie },
      }),
    );
    assert.equal(await oldSessionAfterReset.json(), null);

    // Old password fails, new password succeeds
    const oldPwLogin = await auth.handler(
      new Request('http://localhost:8787/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
        body: JSON.stringify({ email: 'founder@naijapages.ng', password: 'Password123' }),
      }),
    );
    assert.equal(oldPwLogin.status, 401);

    const newPwLogin = await auth.handler(
      new Request('http://localhost:8787/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
        body: JSON.stringify({ email: 'founder@naijapages.ng', password: 'NewPassword456' }),
      }),
    );
    assert.equal(newPwLogin.status, 200);
    const newCookie = extractCookies(newPwLogin.headers);
    assert.ok(newCookie);

    // 7. Logout clears cookie & deletes session from D1
    const logoutRes = await auth.handler(
      new Request('http://localhost:8787/api/auth/sign-out', {
        method: 'POST',
        headers: {
          cookie: newCookie,
          origin: 'http://localhost:8787',
        },
      }),
    );
    assert.equal(logoutRes.status, 200);

    const afterLogout = await auth.handler(
      new Request('http://localhost:8787/api/auth/get-session', {
        headers: { cookie: newCookie },
      }),
    );
    assert.equal(await afterLogout.json(), null);
  } finally {
    await dispose();
  }
});

test('Google OAuth authorize redirect and safe account linking (verified links, unverified blocks)', async () => {
  const sentEmails: OutboundEmail[] = [];
  const { env, dispose } = await setupD1Env({
    GOOGLE_CLIENT_ID: 'test-google-client-id',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  });

  const originalFetch = globalThis.fetch;

  try {
    const auth = createAuth(env, {
      onSendEmail: (mail) => {
        sentEmails.push(mail);
      },
    });

    // Helper to perform a mocked Google OAuth sign-in flow for a given Google profile
    async function runMockGoogleOAuth(googleSub: string, googleEmail: string, emailVerified: boolean) {
      const startRes = await auth.handler(
        new Request('http://localhost:8787/api/auth/sign-in/social', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:8787',
          },
          body: JSON.stringify({
            provider: 'google',
            callbackURL: 'http://localhost:8787/',
            errorCallbackURL: 'http://localhost:8787/?auth=oauth-error',
          }),
        }),
      );
      assert.equal(startRes.status, 200);
      const startJson = (await startRes.json()) as { url: string };
      const googleUrl = new URL(startJson.url);
      assert.equal(googleUrl.origin, 'https://accounts.google.com');
      assert.equal(googleUrl.searchParams.get('client_id'), 'test-google-client-id');
      assert.equal(
        googleUrl.searchParams.get('redirect_uri'),
        'http://localhost:8787/api/auth/callback/google',
      );
      const state = googleUrl.searchParams.get('state')!;
      const oauthCookies = extractCookies(startRes.headers);

      // Stub Google token & userinfo calls during callback
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (target.startsWith('https://oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'mock-google-access-token',
              token_type: 'Bearer',
              expires_in: 3600,
              id_token: makeFakeJwt({
                sub: googleSub,
                email: googleEmail,
                email_verified: emailVerified,
                name: 'Chidi Google',
              }),
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (target.startsWith('https://www.googleapis.com/oauth2/v2/userinfo') || target.startsWith('https://openidconnect.googleapis.com/v1/userinfo')) {
          return new Response(
            JSON.stringify({
              id: googleSub,
              sub: googleSub,
              email: googleEmail,
              verified_email: emailVerified,
              email_verified: emailVerified,
              name: 'Chidi Google',
              picture: 'https://lh3.googleusercontent.com/a/demo',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return originalFetch(input, init);
      };

      try {
        return await auth.handler(
          new Request(
            `http://localhost:8787/api/auth/callback/google?code=mock-auth-code&state=${encodeURIComponent(state)}`,
            {
              method: 'GET',
              headers: { cookie: oauthCookies },
            },
          ),
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    }

    // Case A: Verified email/password account links safely with Google OAuth
    await auth.handler(
      new Request('http://localhost:8787/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
        body: JSON.stringify({
          email: 'chidi@example.com',
          password: 'Password123',
          name: 'Chidi Local',
        }),
      }),
    );
    const verifyMail = sentEmails.find((m) => m.to === 'chidi@example.com');
    assert.ok(verifyMail);
    await auth.handler(new Request(verifyMail.url, { method: 'GET' }));

    const linkedCallbackRes = await runMockGoogleOAuth('google-sub-1', 'chidi@example.com', true);
    assert.equal(linkedCallbackRes.status, 302);
    assert.equal(linkedCallbackRes.headers.get('location'), 'http://localhost:8787/');

    const linkedAccounts = await env.DB.prepare(
      "SELECT provider_id FROM account WHERE user_id = (SELECT id FROM user WHERE email = 'chidi@example.com') ORDER BY provider_id",
    ).all<{ provider_id: string }>();
    assert.deepEqual(
      linkedAccounts.results.map((r) => r.provider_id),
      ['credential', 'google'],
    );

    // Case B: Unverified pre-registered email/password account CANNOT hijack Google sign-in
    await auth.handler(
      new Request('http://localhost:8787/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
        body: JSON.stringify({
          email: 'victim@example.com',
          password: 'AttackerPassword1',
          name: 'Unverified Squat',
        }),
      }),
    );
    const blockedCallbackRes = await runMockGoogleOAuth('google-sub-2', 'victim@example.com', true);
    assert.equal(blockedCallbackRes.status, 302);
    const blockedLocation = blockedCallbackRes.headers.get('location') || '';
    assert.ok(blockedLocation.includes('error=account_not_linked'));

    const victimGoogleLinks = await env.DB.prepare(
      "SELECT provider_id FROM account WHERE user_id = (SELECT id FROM user WHERE email = 'victim@example.com') AND provider_id = 'google'",
    ).all<{ provider_id: string }>();
    assert.equal(victimGoogleLinks.results.length, 0);

    // Case C: Google-first user can safely add password login via verified password reset email
    const googleFirstRes = await runMockGoogleOAuth('google-sub-3', 'amaka@example.com', true);
    assert.equal(googleFirstRes.status, 302);
    assert.equal(googleFirstRes.headers.get('location'), 'http://localhost:8787/');

    await auth.handler(
      new Request('http://localhost:8787/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
        body: JSON.stringify({
          email: 'amaka@example.com',
          redirectTo: 'http://localhost:8787/?auth=reset-password',
        }),
      }),
    );
    const amakaResetMail = sentEmails.find((m) => m.to === 'amaka@example.com' && m.kind === 'password-reset');
    assert.ok(amakaResetMail);
    const amakaCb = await auth.handler(new Request(amakaResetMail.url, { method: 'GET' }));
    const amakaToken = new URL(amakaCb.headers.get('location')!).searchParams.get('token');
    assert.ok(amakaToken);

    const setPwRes = await auth.handler(
      new Request('http://localhost:8787/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
        body: JSON.stringify({ token: amakaToken, newPassword: 'AmakaPassword9' }),
      }),
    );
    assert.equal(setPwRes.status, 200);

    const amakaEmailLogin = await auth.handler(
      new Request('http://localhost:8787/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
        body: JSON.stringify({ email: 'amaka@example.com', password: 'AmakaPassword9' }),
      }),
    );
    assert.equal(amakaEmailLogin.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
    await dispose();
  }
});

test('multi-proxy comma-separated x-forwarded headers resolve cleanly without Invalid base URL', async () => {
  const { env, dispose } = await setupD1Env({
    BETTER_AUTH_URL: '',
    APP_ENV: 'development',
  });
  try {
    const req = new Request('http://127.0.0.1:8787/api/auth/get-session', {
      method: 'GET',
      headers: {
        'x-forwarded-proto': 'https,http',
        'x-forwarded-host': 'ais-dev-example.europe-west2.run.app, localhost:3000',
      },
    });
    const auth = createAuth(env, { request: req });
    const res = await auth.handler(req);
    assert.equal(res.status, 200);
    const body = (await res.json()) as unknown;
    assert.equal(body, null);
  } finally {
    await dispose();
  }
});

