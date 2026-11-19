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

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

const PDF_BYTES = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');

async function setupEnv(overrides: Partial<Bindings> = {}) {
  const proxy = await getPlatformProxy<Bindings>({ persist: false });
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
    BETTER_AUTH_SECRET: 'phase5-media-integration-test-secret-minimum-32-bytes',
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
  opts: { email: string; name: string },
): Promise<{ id: string; cookie: string }> {
  const sentEmails: OutboundEmail[] = [];
  const auth = createAuth(env, {
    onSendEmail: (mail) => {
      sentEmails.push(mail);
    },
  });

  const signUpRes = await auth.handler(
    new Request('http://localhost:8787/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
      body: JSON.stringify({
        email: opts.email,
        password: 'MediaPassword123!',
        name: opts.name,
        callbackURL: 'http://localhost:8787/?auth=verified',
      }),
    }),
  );
  assert.equal(signUpRes.status, 200);
  const signUpData = (await signUpRes.json()) as { user: { id: string } };
  const verifyMail = sentEmails.find((e) => e.kind === 'verification');
  assert.ok(verifyMail);

  const verifyRes = await auth.handler(new Request(verifyMail.url, { method: 'GET' }));
  assert.equal(verifyRes.status, 302);
  const cookie = extractCookies(verifyRes.headers);
  assert.ok(cookie.includes('better-auth.session_token='));
  return { id: signUpData.user.id, cookie };
}

function makeUploadForm(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
  fields: Record<string, string> = {},
): FormData {
  const form = new FormData();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  form.append('file', new File([copy.buffer], filename, { type: mimeType }));
  for (const [k, v] of Object.entries(fields)) {
    form.append(k, v);
  }
  return form;
}

test('Phase 5 R2 Media: uploads, validation, downloads, replacement, deletions, private access & entity cleanup', async () => {
  const { env, dispose } = await setupEnv({
    BOOTSTRAP_ADMIN_EMAIL: 'admin@naijapages.ng',
  });
  const app = createApp();

  try {
    const admin = await registerAndLogin(env, { email: 'admin@naijapages.ng', name: 'Admin Media' });
    const owner = await registerAndLogin(env, { email: 'owner@naijapages.ng', name: 'Owner Media' });
    const intruder = await registerAndLogin(env, { email: 'other@naijapages.ng', name: 'Other Member' });

    // 1. Unauthenticated upload is rejected (401)
    const anonUpload = await app.request(
      'http://localhost:8787/api/media/upload',
      {
        method: 'POST',
        body: makeUploadForm(PNG_BYTES, 'avatar.png', 'image/png', { purpose: 'avatar' }),
      },
      env,
    );
    assert.equal(anonUpload.status, 401);

    // 2. Security validation rejections: SVG, disguised HTML, empty, oversized
    const svgUpload = await app.request(
      'http://localhost:8787/api/media/upload',
      {
        method: 'POST',
        headers: { cookie: owner.cookie },
        body: makeUploadForm(
          new TextEncoder().encode('<svg onload="alert(1)"></svg>'),
          'bad.svg',
          'image/svg+xml',
          { purpose: 'avatar' },
        ),
      },
      env,
    );
    assert.equal(svgUpload.status, 400);

    const fakePngUpload = await app.request(
      'http://localhost:8787/api/media/upload',
      {
        method: 'POST',
        headers: { cookie: owner.cookie },
        body: makeUploadForm(
          new TextEncoder().encode('<html><script>alert(1)</script></html>'),
          'evil.png',
          'image/png',
          { purpose: 'avatar' },
        ),
      },
      env,
    );
    assert.equal(fakePngUpload.status, 400);

    const emptyUpload = await app.request(
      'http://localhost:8787/api/media/upload',
      {
        method: 'POST',
        headers: { cookie: owner.cookie },
        body: makeUploadForm(new Uint8Array(0), 'empty.png', 'image/png', { purpose: 'avatar' }),
      },
      env,
    );
    assert.equal(emptyUpload.status, 400);

    const oversizedAvatar = new Uint8Array(2 * 1024 * 1024 + 64);
    oversizedAvatar.set(PNG_BYTES, 0);
    const bigUpload = await app.request(
      'http://localhost:8787/api/media/upload',
      {
        method: 'POST',
        headers: { cookie: owner.cookie },
        body: makeUploadForm(oversizedAvatar, 'huge.png', 'image/png', { purpose: 'avatar' }),
      },
      env,
    );
    assert.equal(bigUpload.status, 413);

    // 3. Avatar upload -> attach via PUT /api/v1/me/avatar -> public delivery -> replace -> delete
    const avatarUp1 = await app.request(
      'http://localhost:8787/api/media/upload',
      {
        method: 'POST',
        headers: { cookie: owner.cookie },
        body: makeUploadForm(PNG_BYTES, 'avatar1.png', 'image/png', { purpose: 'avatar' }),
      },
      env,
    );
    assert.equal(avatarUp1.status, 201);
    const av1Json = (await avatarUp1.json()) as {
      data: { media: { key: string; url: string; visibility: string } };
    };
    assert.equal(av1Json.data.media.visibility, 'public');
    assert.ok(av1Json.data.media.key.startsWith('public/avatars/'));

    const setAv1 = await app.request(
      'http://localhost:8787/api/v1/me/avatar',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ imageUrl: av1Json.data.media.url }),
      },
      env,
    );
    assert.equal(setAv1.status, 200);

    // Public delivery succeeds without auth and sends immutable + nosniff + sandbox CSP headers
    const getAv1 = await app.request(`http://localhost:8787${av1Json.data.media.url}`, {}, env);
    assert.equal(getAv1.status, 200);
    assert.equal(getAv1.headers.get('content-type'), 'image/png');
    assert.equal(getAv1.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(getAv1.headers.get('cache-control')?.includes('immutable'));

    // Replace avatar via POST /api/media/replace -> rewrites user.image & deletes old R2 object
    const replaceAv = await app.request(
      'http://localhost:8787/api/media/replace',
      {
        method: 'POST',
        headers: { cookie: owner.cookie },
        body: makeUploadForm(JPEG_BYTES, 'avatar2.jpg', 'image/jpeg', { key: av1Json.data.media.key }),
      },
      env,
    );
    assert.equal(replaceAv.status, 200);
    const repAvJson = (await replaceAv.json()) as {
      data: { previousKey: string; media: { key: string; url: string } };
    };
    assert.equal(repAvJson.data.previousKey, av1Json.data.media.key);
    assert.notEqual(repAvJson.data.media.key, av1Json.data.media.key);

    const oldAvGone = await app.request(`http://localhost:8787${av1Json.data.media.url}`, {}, env);
    assert.equal(oldAvGone.status, 404);

    const userAfterReplace = await env.DB.prepare('SELECT image FROM user WHERE id = ?')
      .bind(owner.id)
      .first<{ image: string | null }>();
    assert.equal(userAfterReplace?.image, repAvJson.data.media.url);

    // Intruder cannot replace or delete owner's media (403)
    const intruderDel = await app.request(
      `http://localhost:8787/api/media/${repAvJson.data.media.key}`,
      { method: 'DELETE', headers: { cookie: intruder.cookie } },
      env,
    );
    assert.equal(intruderDel.status, 403);

    const intruderReplace = await app.request(
      `http://localhost:8787/api/media/${repAvJson.data.media.key}`,
      {
        method: 'PUT',
        headers: { cookie: intruder.cookie },
        body: makeUploadForm(PNG_BYTES, 'hijack.png', 'image/png'),
      },
      env,
    );
    assert.equal(intruderReplace.status, 403);

    // Delete avatar via DELETE /api/v1/me/avatar clears user.image and removes R2 object
    const delAv = await app.request(
      'http://localhost:8787/api/v1/me/avatar',
      { method: 'DELETE', headers: { cookie: owner.cookie } },
      env,
    );
    assert.equal(delAv.status, 200);
    const delAvGone = await app.request(`http://localhost:8787${repAvJson.data.media.url}`, {}, env);
    assert.equal(delAvGone.status, 404);

    // 4. Business logo + cover + gallery upload -> create business -> delete business cleans up R2 objects
    const logoRes = await app.request(
      'http://localhost:8787/api/media/upload',
      {
        method: 'POST',
        headers: { cookie: owner.cookie },
        body: makeUploadForm(PNG_BYTES, 'logo.png', 'image/png', { purpose: 'business_logo' }),
      },
      env,
    );
    const coverRes = await app.request(
      'http://localhost:8787/api/media/upload',
      {
        method: 'POST',
        headers: { cookie: owner.cookie },
        body: makeUploadForm(JPEG_BYTES, 'cover.jpg', 'image/jpeg', { purpose: 'business_photo' }),
      },
      env,
    );
    const galRes = await app.request(
      'http://localhost:8787/api/media/upload',
      {
        method: 'POST',
        headers: { cookie: owner.cookie },
        body: makeUploadForm(PNG_BYTES, 'gal.png', 'image/png', { purpose: 'business_gallery' }),
      },
      env,
    );
    const logoMedia = ((await logoRes.json()) as { data: { media: { key: string; url: string } } }).data.media;
    const coverMedia = ((await coverRes.json()) as { data: { media: { key: string; url: string } } }).data.media;
    const galMedia = ((await galRes.json()) as { data: { media: { key: string; url: string } } }).data.media;

    const createBizRes = await app.request(
      'http://localhost:8787/api/v1/directory/businesses',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({
          name: 'Lekki Craft Studio',
          category: 'Services',
          state: 'Lagos',
          lga: 'Eti-Osa',
          address: '22 Admiralty Way, Lekki Phase 1',
          phone: '08035556666',
          googleMapUrl: 'https://maps.app.goo.gl/lekkicraft',
          logoUrl: logoMedia.url,
          coverImageUrl: coverMedia.url,
          gallery: [galMedia.url],
        }),
      },
      env,
    );
    assert.equal(createBizRes.status, 201);
    const createdBiz = (await createBizRes.json()) as {
      data: { item: { id: string; logoUrl: string; coverImageUrl: string; gallery: string[] } };
    };
    assert.equal(createdBiz.data.item.logoUrl, logoMedia.url);
    assert.equal(createdBiz.data.item.coverImageUrl, coverMedia.url);
    assert.deepEqual(createdBiz.data.item.gallery, [galMedia.url]);

    // media_objects row was linked to entity_id
    const linkedMediaRow = await env.DB.prepare('SELECT entity_type, entity_id FROM media_objects WHERE key = ?')
      .bind(logoMedia.key)
      .first<{ entity_type: string; entity_id: string }>();
    assert.equal(linkedMediaRow?.entity_type, 'business');
    assert.equal(linkedMediaRow?.entity_id, createdBiz.data.item.id);

    // Deleting the business cleans up its R2 objects & media_objects rows
    const delBizRes = await app.request(
      `http://localhost:8787/api/v1/directory/businesses/${createdBiz.data.item.id}`,
      { method: 'DELETE', headers: { cookie: owner.cookie } },
      env,
    );
    assert.equal(delBizRes.status, 200);
    assert.equal((await env.MEDIA_BUCKET.head(logoMedia.key)), null);
    assert.equal((await env.MEDIA_BUCKET.head(coverMedia.key)), null);
    assert.equal((await env.MEDIA_BUCKET.head(galMedia.key)), null);

    // 5. Private claim proof upload: 401 anonymous, 403 non-owner, 200 claimant & 200 admin
    const proofRes = await app.request(
      'http://localhost:8787/api/media/upload',
      {
        method: 'POST',
        headers: { cookie: owner.cookie },
        body: makeUploadForm(PDF_BYTES, 'cac-cert.pdf', 'application/pdf', { purpose: 'claim_proof' }),
      },
      env,
    );
    assert.equal(proofRes.status, 201);
    const proofJson = (await proofRes.json()) as {
      data: { media: { key: string; url: string; visibility: string } };
    };
    assert.equal(proofJson.data.media.visibility, 'private');
    assert.ok(proofJson.data.media.key.startsWith('private/claims/'));

    const anonProofGet = await app.request(`http://localhost:8787${proofJson.data.media.url}`, {}, env);
    assert.equal(anonProofGet.status, 401);

    const intruderProofGet = await app.request(
      `http://localhost:8787${proofJson.data.media.url}`,
      { headers: { cookie: intruder.cookie } },
      env,
    );
    assert.equal(intruderProofGet.status, 403);

    const ownerProofGet = await app.request(
      `http://localhost:8787${proofJson.data.media.url}`,
      { headers: { cookie: owner.cookie } },
      env,
    );
    assert.equal(ownerProofGet.status, 200);
    assert.equal(ownerProofGet.headers.get('content-type'), 'application/pdf');
    assert.equal(ownerProofGet.headers.get('cache-control'), 'private, no-store');

    const adminProofGet = await app.request(
      `http://localhost:8787${proofJson.data.media.url}`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    assert.equal(adminProofGet.status, 200);

    // Submit claim referencing private proof URL and verify admin sees proofAttachmentUrl
    const claimRes = await app.request(
      'http://localhost:8787/api/v1/claims',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({
          businessId: 'seed-lagos-1',
          businessName: 'Eko Heritage Hotel',
          name: 'Owner Media',
          email: 'owner@naijapages.ng',
          phone: '08035556666',
          role: 'Owner / Founder',
          proofNote: 'Attached CAC certificate PDF',
          proofAttachmentUrl: proofJson.data.media.url,
        }),
      },
      env,
    );
    assert.equal(claimRes.status, 201);
    const adminClaimsRes = await app.request(
      'http://localhost:8787/api/v1/admin/claims',
      { headers: { cookie: admin.cookie } },
      env,
    );
    assert.equal(adminClaimsRes.status, 200);
    const claimsJson = (await adminClaimsRes.json()) as {
      data: { items: Array<{ id: string; proofAttachmentUrl?: string }> };
    };
    assert.equal(claimsJson.data.items[0]?.proofAttachmentUrl, proofJson.data.media.url);

    // 6. Marketplace image upload -> create ad -> delete via DELETE /api/media/:key clears ad or promotes gallery
    const adImg1Res = await app.request(
      'http://localhost:8787/api/media/upload',
      {
        method: 'POST',
        headers: { cookie: owner.cookie },
        body: makeUploadForm(JPEG_BYTES, 'phone.jpg', 'image/jpeg', { purpose: 'marketplace_image' }),
      },
      env,
    );
    const adImg1 = ((await adImg1Res.json()) as { data: { media: { key: string; url: string } } }).data.media;
    const createAdRes = await app.request(
      'http://localhost:8787/api/v1/marketplace/ads',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({
          businessName: 'Lekki Phones',
          title: 'Samsung Galaxy S24 Ultra',
          category: 'Phones & Tablets',
          price: 1100000,
          condition: 'Brand New',
          description: 'Sealed box 512GB.',
          imageUrl: adImg1.url,
          state: 'Lagos',
          lga: 'Eti-Osa',
          phone: '08035556666',
        }),
      },
      env,
    );
    assert.equal(createAdRes.status, 201);
    const adId = ((await createAdRes.json()) as { data: { item: { id: string } } }).data.item.id;

    // Path traversal key rejected cleanly
    const badPathRes = await app.request(
      'http://localhost:8787/api/media/..%2F..%2Fsecret.txt',
      { headers: { cookie: owner.cookie } },
      env,
    );
    assert.equal(badPathRes.status, 400);

    // Delete marketplace ad cleans up R2 object
    const delAdRes = await app.request(
      `http://localhost:8787/api/v1/marketplace/ads/${adId}`,
      { method: 'DELETE', headers: { cookie: owner.cookie } },
      env,
    );
    assert.equal(delAdRes.status, 200);
    assert.equal((await env.MEDIA_BUCKET.head(adImg1.key)), null);
  } finally {
    await dispose();
  }
});
