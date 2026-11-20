import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import {
  auditSyntheticD1,
  executeSyntheticD1Cleanup,
  isSyntheticBusinessId,
  isSyntheticMarketplaceId,
  renderSyntheticCleanupSql,
} from './cleanup-synthetic-d1-lib';
import type { Bindings } from '../worker/src/types';

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

test('synthetic ID classifiers match generated/mock patterns without false positives', () => {
  assert.equal(isSyntheticBusinessId('sample-lagos-1'), true);
  assert.equal(isSyntheticBusinessId('lagos-gen-42'), true);
  assert.equal(isSyntheticBusinessId('seed-abuja-3'), true);
  assert.equal(isSyntheticBusinessId('mock-hotel-9'), true);
  assert.equal(isSyntheticBusinessId('biz_9f8e7d6c5b4a'), false);
  assert.equal(isSyntheticBusinessId('genesis-pharmacy-lagos'), false);

  assert.equal(isSyntheticMarketplaceId('mkt-1'), true);
  assert.equal(isSyntheticMarketplaceId('mkt-12'), true);
  assert.equal(isSyntheticMarketplaceId('sample-ad-4'), true);
  assert.equal(isSyntheticMarketplaceId('ad_real_user_8842'), false);
});

test('cleanup permanently removes synthetic/mock rows while preserving all genuine user-contributed data', async () => {
  const proxy = await setupFreshD1();
  const db = proxy.env.DB;
  const now = 1760000000000;

  try {
    // 1. Seed users (genuine member + synthetic system user)
    await db
      .prepare(
        `INSERT INTO user (id, name, email, email_verified, role, banned, created_at, updated_at)
         VALUES (?, ?, ?, 1, 'user', 0, ?, ?), (?, ?, ?, 1, 'user', 0, ?, ?)`,
      )
      .bind(
        'u_real_1',
        'Adaeze Okafor',
        'adaeze@example.ng',
        now,
        now,
        'migrated_system',
        'System Seed',
        'migrated_system@migrated.naijapages.local',
        now,
        now,
      )
      .run();

    // 2. Insert genuine business, genuine user-claimed business, and synthetic/mock businesses
    await db
      .prepare(
        `INSERT INTO businesses (
          id, owner_id, owner_name, name, category, state, lga, address, phone,
          google_map_url, tags_json, status, is_verified, claimed, claimed_from_seed_id, created_at, updated_at
        ) VALUES
          ('biz_real_1', 'u_real_1', 'Adaeze Okafor', 'Adaeze Tailoring Studio', 'Beauty', 'Lagos', 'Ikeja', '14 Allen Ave', '08031234567', 'https://maps.app.goo.gl/real1', '[]', 'approved', 1, 0, NULL, ?, ?),
          ('biz_claimed_real', 'u_real_1', 'Adaeze Okafor', 'Real Claimed Clinic', 'Health', 'FCT', 'Abuja Municipal', '22 Wuse II', '08091234567', 'https://maps.app.goo.gl/real2', '[]', 'approved', 1, 1, 'legacy-clinic-1', ?, ?),
          ('sample-lagos-1', 'u_real_1', 'Adaeze Okafor', 'Synthetic Placeholder Co', 'Tech', 'Lagos', 'Ikeja', '1 Fake St', '08030000000', 'https://maps.app.goo.gl/fake1', '[]', 'approved', 1, 0, NULL, ?, ?),
          ('lagos-gen-77', 'migrated_system', 'System Seed', 'Generated Biz 77', 'Food', 'Lagos', 'Eti-Osa', '2 Fake St', '08030000001', 'https://maps.app.goo.gl/fake2', '[]', 'approved', 1, 0, NULL, ?, ?),
          ('biz_tagged_sample', 'u_real_1', 'Adaeze Okafor', 'Tagged Sample Biz', 'Retail', 'Kano', 'Nasarawa', '3 Fake St', '08030000002', 'https://maps.app.goo.gl/fake3', '["isSample"]', 'approved', 0, 0, NULL, ?, ?)`,
      )
      .bind(now, now, now, now, now, now, now, now, now, now)
      .run();

    // 3. Insert genuine marketplace ad + synthetic demo ads
    await db
      .prepare(
        `INSERT INTO marketplace_items (
          id, owner_id, owner_name, business_id, business_name, title, category, price,
          condition, description, image_url, state, lga, phone, status, created_at, updated_at
        ) VALUES
          ('ad_real_1', 'u_real_1', 'Adaeze Okafor', 'biz_real_1', 'Adaeze Tailoring Studio', 'Bespoke Aso Ebi Gown', 'Fashion & Beauty', 85000, 'Brand New', 'Handcrafted gown', '/api/media/public/a.jpg', 'Lagos', 'Ikeja', '08031234567', 'active', ?, ?),
          ('mkt-1', 'u_real_1', 'Adaeze Okafor', NULL, 'Demo Gadgets', 'Fake Demo iPhone', 'Phones & Tablets', 900000, 'Brand New', 'Demo item', 'https://images.unsplash.com/demo', 'Lagos', 'Ikeja', '08030000000', 'active', ?, ?),
          ('ad_linked_fake', 'u_real_1', 'Adaeze Okafor', 'sample-lagos-1', 'Synthetic Placeholder Co', 'Linked Fake Item', 'Services', 50000, 'Brand New', 'Linked to fake biz', 'https://images.unsplash.com/demo2', 'Lagos', 'Ikeja', '08030000000', 'active', ?, ?)`,
      )
      .bind(now, now, now, now, now, now)
      .run();

    // 4. Insert genuine + synthetic dependent rows
    await db
      .prepare(
        `INSERT INTO reviews (id, business_id, author_id, author_name, rating, comment, created_at) VALUES
          ('rev_real_1', 'biz_real_1', 'u_real_1', 'Adaeze Okafor', 5, 'Great service', ?),
          ('rev_fake_1', 'sample-lagos-1', 'u_real_1', 'Adaeze Okafor', 5, 'Review on fake biz', ?)`,
      )
      .bind(now, now)
      .run();

    await db
      .prepare(
        `INSERT INTO favourites (id, user_id, business_id, created_at) VALUES
          ('fav_real_1', 'u_real_1', 'biz_real_1', ?),
          ('fav_fake_1', 'u_real_1', 'lagos-gen-77', ?)`,
      )
      .bind(now, now)
      .run();

    await db
      .prepare(
        `INSERT INTO listing_overrides (id, kind, listing_id, hidden, verified, updated_at) VALUES
          ('business_sample-lagos-1', 'business', 'sample-lagos-1', 1, 0, ?),
          ('marketplace_mkt-1', 'marketplace', 'mkt-1', 1, 0, ?)`,
      )
      .bind(now, now)
      .run();

    // Audit before deletion
    const audit = await auditSyntheticD1(db);
    assert.equal(audit.counts.businesses, 3);
    assert.equal(audit.counts.manualReviewBusinesses, 1);
    assert.equal(audit.counts.marketplaceItems, 2);
    assert.equal(audit.counts.reviews, 1);
    assert.equal(audit.counts.favourites, 1);
    assert.equal(audit.counts.listingOverrides, 2);

    const renderedSql = renderSyntheticCleanupSql(audit);
    assert.ok(!/DELETE FROM businesses;/i.test(renderedSql));
    assert.ok(!/DELETE FROM marketplace_items;/i.test(renderedSql));
    assert.ok(renderedSql.includes("'sample-lagos-1'"));
    assert.ok(renderedSql.includes("'mkt-1'"));

    // Execute targeted cleanup
    const result = await executeSyntheticD1Cleanup(db);
    assert.equal(result.deleted.businesses, 3);
    assert.equal(result.deleted.marketplaceItems, 2);
    assert.equal(result.deleted.reviews, 1);
    assert.equal(result.deleted.favourites, 1);
    assert.equal(result.deleted.listingOverrides, 2);
    assert.equal(result.after.totalDeletions, 0);

    // Verify ALL genuine user-contributed rows remain intact
    const remainingBiz = await db
      .prepare('SELECT id FROM businesses ORDER BY id')
      .all<{ id: string }>();
    assert.deepEqual(
      remainingBiz.results.map((r) => r.id),
      ['biz_claimed_real', 'biz_real_1'],
    );

    const remainingAds = await db
      .prepare('SELECT id FROM marketplace_items ORDER BY id')
      .all<{ id: string }>();
    assert.deepEqual(
      remainingAds.results.map((r) => r.id),
      ['ad_real_1'],
    );

    const remainingRevs = await db
      .prepare('SELECT id FROM reviews ORDER BY id')
      .all<{ id: string }>();
    assert.deepEqual(
      remainingRevs.results.map((r) => r.id),
      ['rev_real_1'],
    );

    const remainingFavs = await db
      .prepare('SELECT id FROM favourites ORDER BY id')
      .all<{ id: string }>();
    assert.deepEqual(
      remainingFavs.results.map((r) => r.id),
      ['fav_real_1'],
    );
  } finally {
    await proxy.dispose();
  }
});
