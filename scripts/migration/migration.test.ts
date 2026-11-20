import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import {
  decodeFirestoreDocument,
  findRemainingFirebaseStorageRefs,
  importDatasetToD1,
  isFirebaseStorageUrl,
  migrateDatasetMediaToR2,
  normalizeSnapshot,
  verifyD1Integrity,
  type FirestoreExportSnapshot,
} from './lib';
import type { Bindings } from '../../worker/src/types';

const MIGRATION_SQLS = [
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0001_initial_schema.sql'), 'utf8'),
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0002_phase4_relational_data.sql'), 'utf8'),
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0003_phase5_r2_media.sql'), 'utf8'),
];

async function setupFreshD1() {
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
  return proxy;
}

test('decodeFirestoreDocument decodes REST value types and nested structures accurately', () => {
  const decoded = decodeFirestoreDocument({
    name: 'projects/demo/databases/(default)/documents/businesses/biz_1',
    fields: {
      name: { stringValue: 'Lagos Bistro' },
      yearEstablished: { integerValue: '2019' },
      rating: { doubleValue: 4.5 },
      isVerified: { booleanValue: true },
      tags: { arrayValue: { values: [{ stringValue: 'dining' }, { stringValue: 'vi' }] } },
      socials: {
        mapValue: {
          fields: {
            instagram: { stringValue: 'https://instagram.com/lagosbistro' },
          },
        },
      },
    },
    createTime: '2025-02-01T10:00:00.000Z',
  });

  assert.equal(decoded.id, 'biz_1');
  assert.equal(decoded.name, 'Lagos Bistro');
  assert.equal(decoded.yearEstablished, 2019);
  assert.equal(decoded.rating, 4.5);
  assert.equal(decoded.isVerified, true);
  assert.deepEqual(decoded.tags, ['dining', 'vi']);
  assert.deepEqual(decoded.socials, { instagram: 'https://instagram.com/lagosbistro' });
});

test('Firestore -> D1 import is idempotent, preserves relations/ratings/bans/admins, and passes integrity checks', async () => {
  const proxy = await setupFreshD1();
  try {
    const snapshot: FirestoreExportSnapshot = {
      version: 1,
      exportedAt: '2025-05-01T00:00:00.000Z',
      projectId: 'naijapages-test',
      collections: {
        users: [
          {
            id: 'uid_admin',
            email: 'admin@naijapages.ng',
            displayName: 'Admin One',
            createdAt: { _seconds: 1735689600, _nanoseconds: 0 },
          },
          {
            id: 'uid_owner',
            email: 'owner@naijapages.ng',
            displayName: 'Tunde Owner',
            favourites: ['biz_lagos_1'],
            createdAt: '2025-02-01T00:00:00.000Z',
          },
          {
            id: 'uid_banned',
            email: 'spam@naijapages.ng',
            displayName: 'Spammer',
            createdAt: 1740000000000,
          },
        ],
        admins: [
          {
            id: 'uid_admin',
            email: 'admin@naijapages.ng',
            addedAt: 1735689700000,
          },
        ],
        bans: [
          {
            id: 'uid_banned',
            email: 'spam@naijapages.ng',
            name: 'Spammer',
            reason: 'Fraudulent listings',
            bannedBy: 'uid_admin',
            bannedAt: 1740100000000,
          },
        ],
        businesses: [
          {
            id: 'biz_lagos_1',
            ownerId: 'uid_owner',
            ownerName: 'Tunde Owner',
            name: 'Victoria Island Roasters',
            category: 'Food',
            state: 'Lagos',
            lga: 'Eti-Osa',
            address: '10 Adeola Odeku St',
            phone: '08031112222',
            googleMapUrl: 'https://maps.app.goo.gl/viroasters',
            status: 'approved',
            isVerified: true,
            claimed: true,
            reviewedBy: 'uid_admin',
            reviewedAt: 1740200000000,
            createdAt: 1740000000000,
          },
        ],
        marketplace_items: [
          {
            id: 'ad_1',
            ownerId: 'uid_owner',
            ownerName: 'Tunde Owner',
            businessId: 'biz_lagos_1',
            businessName: 'Victoria Island Roasters',
            title: 'Commercial Espresso Machine',
            category: 'Commercial & Industrial',
            price: 1850000,
            isNegotiable: true,
            condition: 'Brand New',
            description: '2-group espresso machine.',
            imageUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd',
            state: 'Lagos',
            lga: 'Eti-Osa',
            phone: '08031112222',
            status: 'active',
            createdAt: 1740250000000,
          },
        ],
        reviews: [
          {
            id: 'biz_lagos_1_uid_admin',
            businessId: 'biz_lagos_1',
            authorId: 'uid_admin',
            authorName: 'Admin One',
            rating: 5,
            comment: 'Superb coffee.',
            createdAt: 1740300000000,
          },
          {
            id: 'biz_lagos_1_uid_legacy',
            businessId: 'biz_lagos_1',
            authorId: 'uid_unlisted_in_users_col',
            authorName: 'Legacy Member',
            rating: 4,
            comment: 'Nice ambience.',
            createdAt: 1740350000000,
          },
        ],
        claims: [
          {
            id: 'biz_lagos_1_uid_owner',
            businessId: 'biz_lagos_1',
            businessName: 'Victoria Island Roasters',
            claimantId: 'uid_owner',
            name: 'Tunde Owner',
            email: 'owner@naijapages.ng',
            phone: '08031112222',
            role: 'Owner / Founder',
            status: 'approved',
            reviewedBy: 'uid_admin',
            reviewedAt: 1740200000000,
            createdAt: 1740150000000,
          },
        ],
        reports: [
          {
            id: 'uid_owner_ad_ad_1',
            targetType: 'ad',
            targetId: 'ad_1',
            targetTitle: 'Commercial Espresso Machine',
            reason: 'Wrong category',
            reporterId: 'uid_admin',
            reporterName: 'Admin One',
            status: 'dismissed',
            resolution: 'Category is accurate',
            resolvedBy: 'uid_admin',
            resolvedAt: 1740400000000,
            createdAt: 1740380000000,
          },
        ],
        listing_overrides: [
          {
            id: 'business_seed-curated-1',
            kind: 'business',
            hidden: false,
            verified: true,
            claimedBy: 'uid_owner',
            updatedBy: 'uid_admin',
            updatedAt: 1740410000000,
          },
        ],
        contact_messages: [
          {
            id: 'msg_1',
            uid: 'uid_owner',
            name: 'Tunde Owner',
            email: 'owner@naijapages.ng',
            subject: 'Question',
            message: 'Can I add a second branch?',
            status: 'read',
            createdAt: 1740420000000,
          },
        ],
        newsletter_subscribers: [
          {
            id: 'reader@naijapages.ng',
            email: 'reader@naijapages.ng',
            source: 'homepage_banner',
            status: 'active',
            subscribedAt: '2025-03-01T12:00:00.000Z',
          },
        ],
        site_settings: [
          {
            id: 'site',
            contactEmail: 'hello@naijapages.ng',
            contactPhone: '+2348000000000',
            whatsapp: '2348000000000',
            address: 'Victoria Island, Lagos',
            officeHours: 'Mon-Fri 9am-5pm',
            aboutStory: 'Connecting Nigerian businesses.',
            announcementEnabled: true,
            announcementText: 'Directory live!',
            adsNeedApproval: false,
            updatedAt: 1740430000000,
            updatedBy: 'uid_admin',
          },
        ],
        audit_log: [
          {
            id: 'aud_1',
            adminId: 'uid_admin',
            adminEmail: 'admin@naijapages.ng',
            action: 'business.approve_verify',
            targetType: 'business',
            targetId: 'biz_lagos_1',
            summary: 'Victoria Island Roasters',
            createdAt: 1740200000000,
          },
        ],
      },
    };

    const dataset = normalizeSnapshot(snapshot);

    // Import first time
    await importDatasetToD1(proxy.env.DB, dataset);
    // Re-import second time to verify idempotency (no duplicates or errors)
    await importDatasetToD1(proxy.env.DB, dataset);

    const report = await verifyD1Integrity(proxy.env.DB, dataset);
    assert.equal(report.ok, true, `Integrity issues: ${report.issues.join('; ')}`);
    assert.equal(report.counts.user, 4); // 3 explicit users + 1 synthesized review author
    assert.equal(report.counts.businesses, 1);
    assert.equal(report.counts.marketplace_items, 1);
    assert.equal(report.counts.reviews, 2);
    assert.equal(report.counts.favourites, 1);
    assert.equal(report.counts.admin_records, 1);
    assert.equal(report.counts.user_bans, 1);

    const bizRow = await proxy.env.DB.prepare(
      'SELECT category_id, rating, reviews_count FROM businesses WHERE id = ?',
    )
      .bind('biz_lagos_1')
      .first<{ category_id: string; rating: number; reviews_count: number }>();
    assert.equal(bizRow?.category_id, 'dir_Food');
    assert.equal(bizRow?.rating, 4.5);
    assert.equal(bizRow?.reviews_count, 2);
  } finally {
    await proxy.dispose();
  }
});

test('isFirebaseStorageUrl and migrateDatasetMediaToR2 migrate Firebase Storage URLs to R2 and rewrite D1 references', async () => {
  assert.equal(
    isFirebaseStorageUrl('https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/logos%2F1.png?alt=media'),
    true,
  );
  assert.equal(isFirebaseStorageUrl('gs://demo.appspot.com/businesses/cover.jpg'), true);
  assert.equal(isFirebaseStorageUrl('https://images.unsplash.com/photo-123'), false);
  assert.equal(isFirebaseStorageUrl('/api/media/public/avatars/u1/pic.png'), false);

  const proxy = await setupFreshD1();
  try {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const pdfBytes = new TextEncoder().encode('%PDF-1.4\n%test-proof\n');

    const snapshot: FirestoreExportSnapshot = {
      version: 1,
      exportedAt: '2025-05-01T00:00:00.000Z',
      projectId: 'naijapages-test',
      collections: {
        users: [
          {
            id: 'u_mig_1',
            email: 'u1@naijapages.ng',
            displayName: 'Migrated User',
            photoURL: 'https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/avatars%2Fu1.png?alt=media',
            createdAt: 1740000000000,
          },
        ],
        admins: [],
        bans: [],
        businesses: [
          {
            id: 'biz_mig_1',
            ownerId: 'u_mig_1',
            ownerName: 'Migrated User',
            name: 'R2 Bakery',
            category: 'Food',
            state: 'Lagos',
            lga: 'Ikeja',
            address: '5 Allen Ave',
            phone: '08030001111',
            googleMapUrl: 'https://maps.app.goo.gl/bakery',
            logoUrl: 'https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/avatars%2Fu1.png?alt=media',
            coverImageUrl: 'gs://demo.appspot.com/businesses/cover.png',
            gallery: ['https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/gallery%2Fg1.png?alt=media'],
            status: 'approved',
            createdAt: 1740000000000,
          },
        ],
        marketplace_items: [
          {
            id: 'ad_mig_1',
            ownerId: 'u_mig_1',
            ownerName: 'Migrated User',
            businessName: 'R2 Bakery',
            title: 'Commercial Mixer',
            category: 'Commercial & Industrial',
            price: 300000,
            condition: 'Brand New',
            description: 'Heavy duty mixer.',
            imageUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd',
            additionalImages: ['gs://demo.appspot.com/ads/extra.png'],
            state: 'Lagos',
            lga: 'Ikeja',
            phone: '08030001111',
            status: 'active',
            createdAt: 1740000000000,
          },
        ],
        reviews: [],
        claims: [
          {
            id: 'cl_mig_1',
            businessId: 'biz_mig_1',
            businessName: 'R2 Bakery',
            claimantId: 'u_mig_1',
            name: 'Migrated User',
            email: 'u1@naijapages.ng',
            phone: '08030001111',
            role: 'Owner / Founder',
            proofAttachmentUrl: 'https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/claims%2Fcac.pdf?alt=media',
            status: 'pending',
            createdAt: 1740000000000,
          },
        ],
        reports: [],
        listing_overrides: [],
        contact_messages: [],
        newsletter_subscribers: [],
        site_settings: [],
        audit_log: [],
      },
    };

    const dataset = normalizeSnapshot(snapshot);
    const summary = await migrateDatasetMediaToR2(dataset, {
      bucket: proxy.env.MEDIA_BUCKET,
      nowMs: 1745000000000,
      fetcher: async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('cac.pdf')) {
          return new Response(pdfBytes, { status: 200, headers: { 'content-type': 'application/pdf' } });
        }
        return new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png' } });
      },
    });

    assert.equal(summary.failedCount, 0);
    assert.equal(summary.migratedCount, 5);
    assert.equal(summary.reusedCount, 1); // business.logoUrl reused avatars/u1.png
    assert.equal(summary.skippedCount, 1); // unsplash ad main image left untouched

    assert.ok(dataset.users[0].image?.startsWith('/api/media/public/avatars/'));
    assert.equal(dataset.businesses[0].logoUrl, dataset.users[0].image);
    assert.ok(dataset.businesses[0].coverImageUrl?.startsWith('/api/media/public/businesses/photos/'));
    assert.ok(dataset.claims[0].proofAttachmentUrl?.startsWith('/api/media/private/claims/'));

    await importDatasetToD1(proxy.env.DB, dataset);
    const report = await verifyD1Integrity(proxy.env.DB, dataset);
    assert.equal(report.ok, true, `Integrity issues: ${report.issues.join('; ')}`);
    assert.equal(report.counts.media_objects, 5);

    const remaining = await findRemainingFirebaseStorageRefs(proxy.env.DB);
    assert.equal(remaining.total, 0);
  } finally {
    await proxy.dispose();
  }
});
