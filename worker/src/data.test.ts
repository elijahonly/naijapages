import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { createAuth } from './auth';
import { createApp } from './index';
import type { OutboundEmail } from './lib/email';
import type { Bindings } from './types';

const MIGRATION_SQLS = [
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0001_initial_schema.sql'), 'utf8'),
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0002_phase4_relational_data.sql'), 'utf8'),
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0003_phase5_r2_media.sql'), 'utf8'),
];

async function setupEnv(overrides: Partial<Bindings> = {}) {
  const proxy = await getPlatformProxy<Bindings>({ environment: 'development', persist: false });
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
    BETTER_AUTH_SECRET: 'phase4-integration-test-secret-minimum-32-bytes',
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

async function registerAndLogin(
  env: Bindings,
  opts: { email: string; name: string; password?: string; verify?: boolean },
) {
  const sentEmails: OutboundEmail[] = [];
  const auth = createAuth(env, {
    onSendEmail: (mail) => {
      sentEmails.push(mail);
    },
  });

  const password = opts.password ?? 'NaijaPass123!';
  const signUpRes = await auth.handler(
    new Request('http://localhost:8787/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
      body: JSON.stringify({
        email: opts.email,
        password,
        name: opts.name,
        callbackURL: 'http://localhost:8787/?auth=verified',
      }),
    }),
  );
  assert.equal(signUpRes.status, 200);
  const signUpData = (await signUpRes.json()) as { user: { id: string } };

  if (opts.verify === false) {
    return { id: signUpData.user.id, cookie: '' };
  }

  const verifyMail = sentEmails.find((e) => e.kind === 'verification');
  assert.ok(verifyMail);
  const verifyRes = await auth.handler(new Request(verifyMail.url, { method: 'GET' }));
  assert.equal(verifyRes.status, 302);
  const cookie = extractCookies(verifyRes.headers);
  assert.ok(cookie.includes('better-auth.session_token='));
  return { id: signUpData.user.id, cookie };
}

test('Phase 4 D1 end-to-end: bootstrap, listings, pagination/search, reviews aggregation, favourites, marketplace, claims, reports, bans, audit', async () => {
  const { env, dispose } = await setupEnv({
    BOOTSTRAP_ADMIN_EMAIL: 'admin@naijapages.ng',
  });
  const app = createApp();

  try {
    // 1. Bootstrap & categories
    const bootRes = await app.request('http://localhost:8787/api/v1/directory/bootstrap', {}, env);
    assert.equal(bootRes.status, 200);
    const boot = (await bootRes.json()) as {
      ok: boolean;
      data: {
        businesses: unknown[];
        marketplaceItems: unknown[];
        categories: Array<{ kind: string; key: string }>;
        settings: { adsNeedApproval: boolean };
      };
    };
    assert.equal(boot.ok, true);
    assert.equal(boot.data.businesses.length, 0);
    assert.equal(boot.data.categories.filter((c) => c.kind === 'directory').length, 11);
    assert.equal(boot.data.categories.filter((c) => c.kind === 'marketplace').length, 9);
    assert.equal(boot.data.settings.adsNeedApproval, false);

    // 2. Register Admin, Owner, Reviewer1, Reviewer2
    const adminUser = await registerAndLogin(env, {
      email: 'admin@naijapages.ng',
      name: 'Chief Moderator',
    });
    const owner = await registerAndLogin(env, {
      email: 'owner@naijapages.ng',
      name: 'Chidi Business',
    });
    const reviewer1 = await registerAndLogin(env, {
      email: 'rev1@naijapages.ng',
      name: 'Ada Reviewer',
    });
    const reviewer2 = await registerAndLogin(env, {
      email: 'rev2@naijapages.ng',
      name: 'Tunde Buyer',
    });

    // 3. Unauthenticated or non-admin calls to /api/v1/admin/* are blocked
    const anonAdminRes = await app.request('http://localhost:8787/api/v1/admin/overview', {}, env);
    assert.equal(anonAdminRes.status, 401);

    const memberAdminRes = await app.request(
      'http://localhost:8787/api/v1/admin/overview',
      { headers: { cookie: owner.cookie } },
      env,
    );
    assert.equal(memberAdminRes.status, 403);

    // 4. Owner submits a new business (must default to pending & hidden from public listing)
    const createBizRes = await app.request(
      'http://localhost:8787/api/v1/directory/businesses',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({
          name: 'Wuse Jollof Spot',
          category: 'Food',
          state: 'FCT',
          lga: 'Abuja Municipal',
          address: '14 Aminu Kano Crescent, Wuse II',
          phone: '08031234567',
          whatsapp: '08031234567',
          googleMapUrl: 'https://maps.app.goo.gl/test123',
          website: 'http://wusejollof.ng',
          tags: ['jollof', 'suya'],
          description: 'Fresh smoky party jollof in Abuja.',
        }),
      },
      env,
    );
    assert.equal(createBizRes.status, 201);
    const createdBiz = (await createBizRes.json()) as {
      data: { item: { id: string; status: string; isVerified: boolean; website?: string } };
    };
    const bizId = createdBiz.data.item.id;
    assert.equal(createdBiz.data.item.status, 'pending');
    assert.equal(createdBiz.data.item.isVerified, false);
    assert.equal(createdBiz.data.item.website, 'https://wusejollof.ng/');

    // Public list still hides pending listing
    const publicBeforeApprove = await app.request(
      'http://localhost:8787/api/v1/directory/businesses',
      {},
      env,
    );
    const pubBeforeJson = (await publicBeforeApprove.json()) as { data: { items: unknown[] } };
    assert.equal(pubBeforeJson.data.items.length, 0);

    // My submissions shows it
    const mySubRes = await app.request(
      'http://localhost:8787/api/v1/me/submissions',
      { headers: { cookie: owner.cookie } },
      env,
    );
    assert.equal(mySubRes.status, 200);
    const mySubJson = (await mySubRes.json()) as { data: { businesses: Array<{ id: string }> } };
    assert.equal(mySubJson.data.businesses[0]?.id, bizId);

    // 5. Admin approves & verifies listing + checks audit_log
    const approveRes = await app.request(
      `http://localhost:8787/api/v1/admin/businesses/${bizId}/approve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminUser.cookie },
        body: JSON.stringify({ verify: true }),
      },
      env,
    );
    assert.equal(approveRes.status, 200);

    // Search/filter/pagination test: "Abuja" state synonym matches "FCT" & zone NC
    const searchRes = await app.request(
      'http://localhost:8787/api/v1/directory/businesses?q=suya&state=Abuja&zone=NC&verifiedOnly=true&page=1&pageSize=5',
      {},
      env,
    );
    assert.equal(searchRes.status, 200);
    const searchJson = (await searchRes.json()) as {
      data: {
        items: Array<{ id: string; isVerified: boolean }>;
        pagination: { total: number; totalPages: number };
      };
    };
    assert.equal(searchJson.data.items.length, 1);
    assert.equal(searchJson.data.items[0].id, bizId);
    assert.equal(searchJson.data.items[0].isVerified, true);
    assert.equal(searchJson.data.pagination.total, 1);

    // 6. Reviews & atomic rating recalculation
    // Owner cannot review own business
    const selfReviewRes = await app.request(
      `http://localhost:8787/api/v1/directory/businesses/${bizId}/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ rating: 5, comment: 'My own place is awesome!' }),
      },
      env,
    );
    assert.equal(selfReviewRes.status, 403);

    // Reviewer 1 posts 4-star review
    const rev1Res = await app.request(
      `http://localhost:8787/api/v1/directory/businesses/${bizId}/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: reviewer1.cookie },
        body: JSON.stringify({ rating: 4, comment: 'Great jollof and fast service.' }),
      },
      env,
    );
    assert.equal(rev1Res.status, 201);
    const rev1Data = (await rev1Res.json()) as { data: { item: { id: string } } };

    // Duplicate review by Reviewer 1 fails with 409 ALREADY_EXISTS
    const dupRevRes = await app.request(
      `http://localhost:8787/api/v1/directory/businesses/${bizId}/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: reviewer1.cookie },
        body: JSON.stringify({ rating: 5, comment: 'Second review attempt.' }),
      },
      env,
    );
    assert.equal(dupRevRes.status, 409);

    // Reviewer 2 posts 5-star review -> average = 4.5, count = 2
    const rev2Res = await app.request(
      `http://localhost:8787/api/v1/directory/businesses/${bizId}/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: reviewer2.cookie },
        body: JSON.stringify({ rating: 5, comment: 'Best suya in Wuse II!' }),
      },
      env,
    );
    assert.equal(rev2Res.status, 201);

    const bizAfterReviews = await app.request(
      `http://localhost:8787/api/v1/directory/businesses/${bizId}`,
      {},
      env,
    );
    const bizAfterJson = (await bizAfterReviews.json()) as {
      data: { item: { rating: number; reviewsCount: number } };
    };
    assert.equal(bizAfterJson.data.item.rating, 4.5);
    assert.equal(bizAfterJson.data.item.reviewsCount, 2);

    // Deleting Reviewer 1's review recalculates average back to 5.0, count = 1
    const delRevRes = await app.request(
      `http://localhost:8787/api/v1/directory/reviews/${rev1Data.data.item.id}`,
      { method: 'DELETE', headers: { cookie: reviewer1.cookie } },
      env,
    );
    assert.equal(delRevRes.status, 200);

    const bizAfterDel = await app.request(
      `http://localhost:8787/api/v1/directory/businesses/${bizId}`,
      {},
      env,
    );
    const bizAfterDelJson = (await bizAfterDel.json()) as {
      data: { item: { rating: number; reviewsCount: number } };
    };
    assert.equal(bizAfterDelJson.data.item.rating, 5);
    assert.equal(bizAfterDelJson.data.item.reviewsCount, 1);

    // 7. Favourites CRUD & sync
    const syncRes = await app.request(
      'http://localhost:8787/api/v1/directory/favourites/sync',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: reviewer1.cookie },
        body: JSON.stringify({ businessIds: [bizId, 'seed-curated-1'] }),
      },
      env,
    );
    assert.equal(syncRes.status, 200);
    const syncJson = (await syncRes.json()) as { data: { businessIds: string[] } };
    assert.deepEqual(syncJson.data.businessIds.sort(), ['seed-curated-1', bizId].sort());

    const remFavRes = await app.request(
      `http://localhost:8787/api/v1/directory/favourites/${bizId}`,
      { method: 'DELETE', headers: { cookie: reviewer1.cookie } },
      env,
    );
    assert.equal(remFavRes.status, 200);
    const remFavJson = (await remFavRes.json()) as { data: { businessIds: string[] } };
    assert.deepEqual(remFavJson.data.businessIds, ['seed-curated-1']);

    // 8. Marketplace ad linked to verified business derives isVerifiedSeller = true
    const createAdRes = await app.request(
      'http://localhost:8787/api/v1/marketplace/ads',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({
          businessId: bizId,
          businessName: 'Wuse Jollof Spot',
          title: 'Party Catering Pack for 50 Guests',
          category: 'Agriculture & Food',
          price: 150000,
          isNegotiable: true,
          condition: 'Brand New',
          description: 'Hot party jollof and grilled chicken trays.',
          imageUrl: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836',
          state: 'FCT',
          lga: 'Abuja Municipal',
          phone: '08031234567',
        }),
      },
      env,
    );
    assert.equal(createAdRes.status, 201);
    const adJson = (await createAdRes.json()) as {
      data: { item: { id: string; status: string; isVerifiedSeller: boolean } };
    };
    const adId = adJson.data.item.id;
    assert.equal(adJson.data.item.status, 'active');
    assert.equal(adJson.data.item.isVerifiedSeller, true);

    // Switching adsNeedApproval on forces new ad to pending
    const saveSettingsRes = await app.request(
      'http://localhost:8787/api/v1/admin/settings',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: adminUser.cookie },
        body: JSON.stringify({
          contactEmail: 'hello@naijapages.ng',
          contactPhone: '+2348000000000',
          whatsapp: '2348000000000',
          address: 'Abuja',
          officeHours: 'Mon-Fri',
          aboutStory: 'Built for Nigerian businesses.',
          announcementEnabled: true,
          announcementText: 'Welcome to NaijaPages!',
          adsNeedApproval: true,
        }),
      },
      env,
    );
    assert.equal(saveSettingsRes.status, 200);

    const pendingAdRes = await app.request(
      'http://localhost:8787/api/v1/marketplace/ads',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: reviewer1.cookie },
        body: JSON.stringify({
          businessName: 'Ada Gadgets',
          title: 'iPhone 15 Pro Max UK Used',
          category: 'Phones & Tablets',
          price: 1200000,
          isNegotiable: false,
          condition: 'Foreign Used (Tokunbo)',
          description: 'Clean factory unlocked phone.',
          imageUrl: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9',
          state: 'Lagos',
          lga: 'Ikeja',
          phone: '08099998888',
        }),
      },
      env,
    );
    assert.equal(pendingAdRes.status, 201);
    const pendingAdJson = (await pendingAdRes.json()) as {
      data: { item: { id: string; status: string; isVerifiedSeller: boolean } };
    };
    assert.equal(pendingAdJson.data.item.status, 'pending');
    assert.equal(pendingAdJson.data.item.isVerifiedSeller, false);

    // 9. Claim on a built-in seed listing -> Admin approval sets listing_overrides
    const claimRes = await app.request(
      'http://localhost:8787/api/v1/claims',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: reviewer1.cookie },
        body: JSON.stringify({
          businessId: 'seed-lagos-1',
          businessName: 'Eko Heritage Hotel',
          name: 'Ada Reviewer',
          email: 'rev1@naijapages.ng',
          phone: '08099998888',
          role: 'Owner / Founder',
          proofNote: 'RC-987654',
        }),
      },
      env,
    );
    assert.equal(claimRes.status, 201);
    const claimId = `${'seed-lagos-1'}_${reviewer1.id}`;

    const approveClaimRes = await app.request(
      `http://localhost:8787/api/v1/admin/claims/${claimId}/approve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminUser.cookie },
        body: JSON.stringify({ note: 'CAC verified' }),
      },
      env,
    );
    assert.equal(approveClaimRes.status, 200);
    const ovrRow = await env.DB.prepare('SELECT verified, claimed_by FROM listing_overrides WHERE id = ?')
      .bind('business_seed-lagos-1')
      .first<{ verified: number; claimed_by: string }>();
    assert.equal(ovrRow?.verified, 1);
    assert.equal(ovrRow?.claimed_by, reviewer1.id);

    // 10. Report ad -> Admin inspects target -> resolves by removing ad & banning owner
    const reportRes = await app.request(
      'http://localhost:8787/api/v1/reports',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: reviewer2.cookie },
        body: JSON.stringify({
          targetType: 'ad',
          targetId: pendingAdJson.data.item.id,
          targetTitle: 'iPhone 15 Pro Max UK Used',
          reason: 'Scam or fraud',
          details: 'Asked for upfront delivery transfer.',
        }),
      },
      env,
    );
    assert.equal(reportRes.status, 201);
    const reportId = `${reviewer2.id}_ad_${pendingAdJson.data.item.id}`;

    const targetRes = await app.request(
      `http://localhost:8787/api/v1/admin/reports/${reportId}/target`,
      { headers: { cookie: adminUser.cookie } },
      env,
    );
    assert.equal(targetRes.status, 200);
    const targetJson = (await targetRes.json()) as {
      data: { target: { kind: string; ownerId: string; ownerIsAdmin: boolean } };
    };
    assert.equal(targetJson.data.target.kind, 'community');
    assert.equal(targetJson.data.target.ownerId, reviewer1.id);
    assert.equal(targetJson.data.target.ownerIsAdmin, false);

    const resolveReportRes = await app.request(
      `http://localhost:8787/api/v1/admin/reports/${reportId}/action`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminUser.cookie },
        body: JSON.stringify({
          status: 'resolved',
          note: 'Confirmed scam',
          removeContent: true,
          banOwner: { reason: 'Scam ad', name: 'Ada Reviewer' },
        }),
      },
      env,
    );
    assert.equal(resolveReportRes.status, 200);

    // Banning revokes existing sessions immediately (401) and blocks write mutations even if re-authenticated (403 ACCOUNT_BANNED)
    const revokedRes = await app.request(
      'http://localhost:8787/api/v1/directory/businesses',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: reviewer1.cookie },
        body: JSON.stringify({
          name: 'Blocked Biz',
          category: 'Tech',
          state: 'Lagos',
          lga: 'Ikeja',
          address: '10 Allen Ave',
          phone: '08011112222',
          googleMapUrl: 'https://maps.app.goo.gl/blocked',
        }),
      },
      env,
    );
    assert.equal(revokedRes.status, 401);

    const reLoginRes = await app.request(
      'http://localhost:8787/api/auth/sign-in/email',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
        body: JSON.stringify({ email: 'rev1@naijapages.ng', password: 'NaijaPass123!' }),
      },
      env,
    );
    assert.equal(reLoginRes.status, 200);
    const bannedCookie = extractCookies(reLoginRes.headers);

    const bannedCreateRes = await app.request(
      'http://localhost:8787/api/v1/directory/businesses',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: bannedCookie },
        body: JSON.stringify({
          name: 'Blocked Biz',
          category: 'Tech',
          state: 'Lagos',
          lga: 'Ikeja',
          address: '10 Allen Ave',
          phone: '08011112222',
          googleMapUrl: 'https://maps.app.goo.gl/blocked',
        }),
      },
      env,
    );
    assert.equal(bannedCreateRes.status, 403);
    const bannedErr = (await bannedCreateRes.json()) as { error: { code: string } };
    assert.equal(bannedErr.error.code, 'ACCOUNT_BANNED');

    // 11. Contact & Newsletter anti-enumeration + Admin overview/audit verification
    const contactRes = await app.request(
      'http://localhost:8787/api/v1/contact',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Visitor One',
          email: 'visitor@example.com',
          subject: '[General question] Partnership inquiry',
          message: 'Hello team, we would like to partner on Lagos directory verification.',
        }),
      },
      env,
    );
    assert.equal(contactRes.status, 201);

    const sub1 = await app.request(
      'http://localhost:8787/api/v1/newsletter',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'digest@example.com', source: 'homepage_banner' }),
      },
      env,
    );
    assert.equal(sub1.status, 201);
    // Duplicate newsletter email also returns 201 (anti-enumeration)
    const sub2 = await app.request(
      'http://localhost:8787/api/v1/newsletter',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'digest@example.com', source: 'homepage_banner' }),
      },
      env,
    );
    assert.equal(sub2.status, 201);

    // Admin cannot revoke own admin rights
    const selfRevoke = await app.request(
      `http://localhost:8787/api/v1/admin/users/${adminUser.id}/revoke-admin`,
      { method: 'POST', headers: { cookie: adminUser.cookie } },
      env,
    );
    assert.equal(selfRevoke.status, 400);

    // Audit log recorded all mutations
    const auditRes = await app.request(
      'http://localhost:8787/api/v1/admin/audit?limit=50',
      { headers: { cookie: adminUser.cookie } },
      env,
    );
    assert.equal(auditRes.status, 200);
    const auditJson = (await auditRes.json()) as { data: { items: Array<{ action: string }> } };
    const actions = new Set(auditJson.data.items.map((a) => a.action));
    assert.ok(actions.has('business.approve_verify'));
    assert.ok(actions.has('settings.update'));
    assert.ok(actions.has('claim.approve'));
    assert.ok(actions.has('user.ban'));
    assert.ok(actions.has('report.resolve'));

    // Phase 6: Owner profile loading & editing + owner business editing
    const profileRes = await app.request(
      'http://localhost:8787/api/v1/me/profile',
      { headers: { cookie: owner.cookie } },
      env,
    );
    assert.equal(profileRes.status, 200);
    const profileJson = (await profileRes.json()) as { data: { profile: { displayName: string; email: string } } };
    assert.equal(profileJson.data.profile.email, 'owner@naijapages.ng');

    const patchProfileRes = await app.request(
      'http://localhost:8787/api/v1/me/profile',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ displayName: 'Chidi Updated' }),
      },
      env,
    );
    assert.equal(patchProfileRes.status, 200);
    const patchedProfileJson = (await patchProfileRes.json()) as { data: { profile: { displayName: string } } };
    assert.equal(patchedProfileJson.data.profile.displayName, 'Chidi Updated');

    // Non-owner cannot PATCH someone else's business
    const nonOwnerEditRes = await app.request(
      `http://localhost:8787/api/v1/directory/businesses/${bizId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: reviewer2.cookie },
        body: JSON.stringify({
          name: 'Hijacked Jollof',
          category: 'Food',
          state: 'FCT',
          lga: 'Abuja Municipal',
          address: '14 Aminu Kano Crescent, Wuse II',
          phone: '08031234567',
          googleMapUrl: 'https://maps.app.goo.gl/test123',
        }),
      },
      env,
    );
    assert.equal(nonOwnerEditRes.status, 403);

    // Owner can edit their business listing
    const ownerEditRes = await app.request(
      `http://localhost:8787/api/v1/directory/businesses/${bizId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({
          name: 'Wuse Jollof Spot & Grill',
          category: 'Food',
          state: 'FCT',
          lga: 'Abuja Municipal',
          address: '14 Aminu Kano Crescent, Wuse II',
          phone: '08031234567',
          whatsapp: '08031234567',
          googleMapUrl: 'https://maps.app.goo.gl/test123',
          openingHours: 'Mon - Sun: 9:00 AM - 10:00 PM',
          description: 'Updated description with weekend grill hours.',
        }),
      },
      env,
    );
    assert.equal(ownerEditRes.status, 200);
    const ownerEditJson = (await ownerEditRes.json()) as {
      data: { item: { name: string; openingHours?: string; status: string } };
    };
    assert.equal(ownerEditJson.data.item.name, 'Wuse Jollof Spot & Grill');
    assert.equal(ownerEditJson.data.item.openingHours, 'Mon - Sun: 9:00 AM - 10:00 PM');
    assert.equal(ownerEditJson.data.item.status, 'approved');

    // Cleanup owner's ad check
    const delAdRes = await app.request(
      `http://localhost:8787/api/v1/marketplace/ads/${adId}`,
      { method: 'DELETE', headers: { cookie: owner.cookie } },
      env,
    );
    assert.equal(delAdRes.status, 200);
  } finally {
    await dispose();
  }
});
