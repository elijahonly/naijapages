import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { getPlatformProxy } from 'wrangler';
import {
  businessEvidence,
  createDb,
  discoveredBusinesses,
  discoveryJobs,
  discoverySources,
} from './db/schema';
import {
  isDiscoverySourceUsable,
  isWithinNigeriaBounds,
  normalizeBusinessName,
  normalizeNigerianState,
  safeParseJsonObject,
  validateBusinessEvidenceInput,
  validateConfidenceScore,
  validateCoordinates,
  validateDiscoveredBusinessInput,
  validateDiscoveryJobInput,
  validateDiscoverySourceInput,
  validateDiscoveryUrl,
  validateEpochTimestamp,
  validateRequiredIdentifier,
} from './lib/discoveryValidation';
import { ValidationError } from './lib/validation';
import type { Bindings } from './types';

const MIGRATION_SQLS = [
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0001_initial_schema.sql'), 'utf8'),
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0002_phase4_relational_data.sql'), 'utf8'),
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0003_phase5_r2_media.sql'), 'utf8'),
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0004_business_discovery.sql'), 'utf8'),
];

async function setupDiscoveryDb() {
  const proxy = await getPlatformProxy<Bindings>({ environment: 'development', persist: false });
  for (const sqlText of MIGRATION_SQLS) {
    const statements = sqlText
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

function matchesConstraint(pattern: RegExp) {
  return (err: unknown): boolean => {
    const parts: string[] = [];
    let cur: unknown = err;
    for (let depth = 0; depth < 5 && cur; depth += 1) {
      if (cur instanceof Error) {
        parts.push(cur.message);
        cur = (cur as Error & { cause?: unknown }).cause;
      } else {
        parts.push(String(cur));
        break;
      }
    }
    const combined = parts.join(' | ');
    assert.match(combined, pattern);
    return true;
  };
}

// ---------------------------------------------------------------------------
// 1. Pure Validation & Data Integrity Helpers (No Fake Defaults)
// ---------------------------------------------------------------------------

test('discovery validation helpers enforce Nigerian states, coordinates, confidence, URLs, JSON, and field lengths', () => {
  // Nigerian state normalization
  assert.equal(normalizeNigerianState(null), null);
  assert.equal(normalizeNigerianState(''), null);
  assert.equal(normalizeNigerianState('lagos'), 'Lagos');
  assert.equal(normalizeNigerianState('Ogun State'), 'Ogun');
  assert.equal(normalizeNigerianState('Abuja'), 'FCT');
  assert.equal(normalizeNigerianState('Federal Capital Territory'), 'FCT');
  assert.throws(() => normalizeNigerianState('Atlantis'), ValidationError);

  // Coordinate validation & Nigeria bounding box
  assert.deepEqual(validateCoordinates(null, null), { latitude: null, longitude: null });
  assert.deepEqual(validateCoordinates(6.5244, 3.3792), { latitude: 6.5244, longitude: 3.3792 });
  assert.equal(isWithinNigeriaBounds(6.5244, 3.3792), true);
  assert.equal(isWithinNigeriaBounds(51.5074, -0.1278), false);
  assert.throws(() => validateCoordinates(6.5244, null), ValidationError);
  assert.throws(() => validateCoordinates(null, 3.3792), ValidationError);
  assert.throws(() => validateCoordinates(95, 3.3792), ValidationError);
  assert.throws(() => validateCoordinates(6.5244, 181), ValidationError);
  assert.throws(() => validateCoordinates(Number.NaN, 3.3792), ValidationError);
  assert.throws(
    () => validateCoordinates(51.5074, -0.1278, { requireNigeriaBounds: true }),
    ValidationError,
  );

  // Confidence score boundaries
  assert.equal(validateConfidenceScore(0), 0);
  assert.equal(validateConfidenceScore(0.75), 0.75);
  assert.equal(validateConfidenceScore(1), 1);
  assert.throws(() => validateConfidenceScore(-0.01), ValidationError);
  assert.throws(() => validateConfidenceScore(1.01), ValidationError);
  assert.throws(() => validateConfidenceScore(Number.NaN), ValidationError);
  assert.throws(() => validateConfidenceScore(Number.POSITIVE_INFINITY), ValidationError);

  // Timestamps
  assert.equal(validateEpochTimestamp(null, 'last_checked_at'), null);
  assert.equal(validateEpochTimestamp(1760000000000, 'first_seen_at', { required: true }), 1760000000000);
  assert.throws(() => validateEpochTimestamp(-1, 'first_seen_at'), ValidationError);
  assert.throws(() => validateEpochTimestamp(123.45, 'first_seen_at'), ValidationError);
  assert.throws(() => validateEpochTimestamp(null, 'first_seen_at', { required: true }), ValidationError);

  // Required identifiers & URLs
  assert.equal(validateRequiredIdentifier('osm_nigeria', 'source_id'), 'osm_nigeria');
  assert.throws(() => validateRequiredIdentifier('   ', 'source_id'), ValidationError);
  assert.throws(() => validateRequiredIdentifier('a'.repeat(121), 'source_id', 120), ValidationError);

  assert.equal(validateDiscoveryUrl(null, 'source_url'), null);
  assert.equal(
    validateDiscoveryUrl('https://www.openstreetmap.org/node/12345', 'source_url'),
    'https://www.openstreetmap.org/node/12345',
  );
  assert.throws(() => validateDiscoveryUrl('javascript:alert(1)', 'source_url'), ValidationError);
  assert.throws(() => validateDiscoveryUrl('https://user:pass@example.com', 'source_url'), ValidationError);
  assert.throws(
    () => validateDiscoveryUrl('http://insecure.example.com', 'base_url', { httpsOnly: true }),
    ValidationError,
  );

  // Safe JSON parsing & prototype pollution protection
  assert.deepEqual(safeParseJsonObject(''), {});
  const parsed = safeParseJsonObject('{"lga":"Ikeja","__proto__":{"polluted":true}}');
  assert.equal(parsed.lga, 'Ikeja');
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, '__proto__'), false);
  assert.throws(() => safeParseJsonObject('{bad json'), ValidationError);
  assert.throws(() => safeParseJsonObject('["array-not-object"]'), ValidationError);
  assert.throws(() => safeParseJsonObject('{"x":"' + 'a'.repeat(200) + '"}', { maxBytes: 100 }), ValidationError);

  // Business name normalization
  assert.equal(normalizeBusinessName('  Adebayo & Sons Pharmacy Ltd.  '), 'adebayo and sons pharmacy ltd');
});

test('source governance prevents unapproved sources from being enabled or treated as usable', () => {
  const pending = validateDiscoverySourceInput({
    id: 'src_pending_1',
    name: 'Pending Registry Source',
    sourceType: 'public_registry',
    baseUrl: 'https://registry.example.ng',
    licenceName: 'Pending Legal Review',
    permissionStatus: 'pending_review',
    enabled: false,
  });
  assert.equal(pending.permissionStatus, 'pending_review');
  assert.equal(pending.enabled, false);
  assert.equal(isDiscoverySourceUsable(pending), false);

  assert.throws(
    () =>
      validateDiscoverySourceInput({
        id: 'src_illegal_enable',
        name: 'Unapproved Enabled Source',
        sourceType: 'web_directory',
        baseUrl: 'https://directory.example.ng',
        licenceName: 'Unknown',
        permissionStatus: 'pending_review',
        enabled: true,
      }),
    ValidationError,
  );

  const approved = validateDiscoverySourceInput({
    id: 'src_approved_1',
    name: 'Open Data Fixture',
    sourceType: 'open_data',
    baseUrl: 'https://opendata.example.org',
    licenceName: 'ODbL-1.0',
    licenceUrl: 'https://opendatacommons.org/licenses/odbl/',
    attributionText: 'Data contributors',
    permissionStatus: 'approved',
    enabled: true,
  });
  assert.equal(isDiscoverySourceUsable(approved), true);
  assert.equal(isDiscoverySourceUsable({ permissionStatus: 'revoked', enabled: true }), false);
});

test('candidate validation preserves null contact fields without fabricating defaults and validates statuses', () => {
  const candidate = validateDiscoveredBusinessInput({
    id: 'cand_incomplete_1',
    sourceId: 'src_approved_1',
    sourceRecordId: 'node/998877',
    name: 'Kano Grain Depot',
    firstSeenAt: 1760000000000,
    lastSeenAt: 1760000000500,
  });

  assert.equal(candidate.phone, null);
  assert.equal(candidate.secondaryPhone, null);
  assert.equal(candidate.email, null);
  assert.equal(candidate.website, null);
  assert.equal(candidate.address, null);
  assert.equal(candidate.state, null);
  assert.equal(candidate.lga, null);
  assert.equal(candidate.latitude, null);
  assert.equal(candidate.longitude, null);
  assert.equal(candidate.reviewStatus, 'discovered');
  assert.equal(candidate.verificationStatus, 'unverified');
  assert.equal(candidate.confidenceScore, 0);

  // Invalid review_status / verification_status / inverted timestamps rejected
  assert.throws(
    () =>
      validateDiscoveredBusinessInput({
        id: 'cand_bad_status',
        sourceId: 'src_approved_1',
        sourceRecordId: 'node/1',
        name: 'Bad Status Co',
        reviewStatus: 'published_live',
      }),
    ValidationError,
  );
  assert.throws(
    () =>
      validateDiscoveredBusinessInput({
        id: 'cand_bad_verif',
        sourceId: 'src_approved_1',
        sourceRecordId: 'node/2',
        name: 'Bad Verif Co',
        verificationStatus: 'gold_verified_badge',
      }),
    ValidationError,
  );
  assert.throws(
    () =>
      validateDiscoveredBusinessInput({
        id: 'cand_bad_times',
        sourceId: 'src_approved_1',
        sourceRecordId: 'node/3',
        name: 'Time Travel Co',
        firstSeenAt: 1760000005000,
        lastSeenAt: 1760000001000,
      }),
    ValidationError,
  );

  // Job validation checks
  assert.throws(
    () =>
      validateDiscoveryJobInput({
        id: 'job_bad_times',
        sourceId: 'src_approved_1',
        jobType: 'state_sweep',
        startedAt: 1760000010000,
        completedAt: 1760000005000,
      }),
    ValidationError,
  );

  // Evidence validation checks
  const ev = validateBusinessEvidenceInput({
    id: 'ev_1',
    discoveredBusinessId: 'cand_incomplete_1',
    sourceId: 'src_approved_1',
    evidenceType: 'source_record',
    fieldName: 'name',
    evidenceValue: 'Kano Grain Depot',
    confidence: 0.8,
    collectedAt: 1760000000500,
  });
  assert.equal(ev.confidence, 0.8);
  assert.equal(ev.sourceUrl, null);
});

// ---------------------------------------------------------------------------
// 2. D1 Migration, Constraints, Indexes & Drizzle ORM Integration Tests
// ---------------------------------------------------------------------------

test('0004_business_discovery migration creates all tables, indexes, constraints, and works with Drizzle ORM', async () => {
  const proxy = await setupDiscoveryDb();
  const d1 = proxy.env.DB;
  const db = createDb(d1);
  const now = 1760000000000;

  try {
    // 1. Verify migration structure: all 4 new tables exist and existing tables remain intact
    const tablesRes = await d1
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all<{ name: string }>();
    const tableNames = new Set(tablesRes.results.map((r) => r.name));
    for (const expected of [
      'businesses',
      'user',
      'marketplace_items',
      'discovery_sources',
      'discovery_jobs',
      'discovered_businesses',
      'business_evidence',
    ]) {
      assert.ok(tableNames.has(expected), `Expected table ${expected} to exist`);
    }

    // Verify key indexes exist
    const indexesRes = await d1
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name`)
      .all<{ name: string }>();
    const indexNames = new Set(indexesRes.results.map((r) => r.name));
    for (const expectedIndex of [
      'idx_discovery_sources_status_enabled',
      'idx_discovery_jobs_idempotency_key',
      'idx_discovery_jobs_next_queue',
      'idx_discovery_jobs_status_created',
      'idx_discovery_jobs_geo_category',
      'idx_discovered_businesses_source_record',
      'idx_discovered_businesses_review_status',
      'idx_discovered_businesses_state_lga_status',
      'idx_discovered_businesses_category_state',
      'idx_discovered_businesses_identity_hash',
      'idx_business_evidence_candidate_collected',
      'idx_business_evidence_candidate_field',
    ]) {
      assert.ok(indexNames.has(expectedIndex), `Expected index ${expectedIndex} to exist`);
    }

    // 2. Unapproved source cannot be enabled at the SQLite CHECK level
    await assert.rejects(
      async () => {
        await db.insert(discoverySources).values({
          id: 'src_unapproved_db',
          name: 'Unapproved Source',
          sourceType: 'open_data',
          baseUrl: 'https://unapproved.example.org',
          licenceName: 'Pending',
          permissionStatus: 'pending_review',
          enabled: true,
          rateLimitPerMinute: 30,
          createdAt: now,
          updatedAt: now,
        });
      },
      matchesConstraint(/CHECK constraint failed/i),
    );

    // Insert one approved source and one pending source (disabled) via Drizzle
    await db.insert(discoverySources).values([
      {
        id: 'src_fixture_osm',
        name: 'Fixture Open Map Data',
        sourceType: 'open_data',
        baseUrl: 'https://openmap.fixture.example',
        licenceName: 'ODbL-1.0',
        licenceUrl: 'https://opendatacommons.org/licenses/odbl/',
        attributionText: 'Fixture Open Map contributors',
        permittedUsage: 'Directory discovery with attribution',
        permissionStatus: 'approved',
        enabled: true,
        rateLimitPerMinute: 20,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'src_fixture_registry',
        name: 'Fixture Secondary Registry',
        sourceType: 'public_registry',
        baseUrl: 'https://registry.fixture.example',
        licenceName: 'Public Open Government Licence',
        permissionStatus: 'pending_review',
        enabled: false,
        rateLimitPerMinute: 10,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 3. Foreign key integrity: job referencing non-existent source must fail
    await assert.rejects(
      async () => {
        await db.insert(discoveryJobs).values({
          id: 'job_orphan',
          sourceId: 'src_does_not_exist',
          jobType: 'state_sweep',
          country: 'Nigeria',
          state: 'Lagos',
          status: 'queued',
          priority: 10,
          createdAt: now,
          updatedAt: now,
        });
      },
      matchesConstraint(/FOREIGN KEY constraint failed/i),
    );

    // 4. Idempotency key uniqueness: duplicate non-null key fails; multiple NULL keys allowed
    await db.insert(discoveryJobs).values({
      id: 'job_1',
      sourceId: 'src_fixture_osm',
      jobType: 'state_sweep',
      country: 'Nigeria',
      state: 'Lagos',
      lga: 'Ikeja',
      category: 'Health',
      status: 'queued',
      priority: 10,
      idempotencyKey: 'osm:state_sweep:lagos:ikeja:2026-11',
      createdAt: now,
      updatedAt: now,
    });

    await assert.rejects(
      async () => {
        await db.insert(discoveryJobs).values({
          id: 'job_1_dup',
          sourceId: 'src_fixture_osm',
          jobType: 'state_sweep',
          country: 'Nigeria',
          state: 'Lagos',
          status: 'queued',
          priority: 10,
          idempotencyKey: 'osm:state_sweep:lagos:ikeja:2026-11',
          createdAt: now + 1000,
          updatedAt: now + 1000,
        });
      },
      matchesConstraint(/UNIQUE constraint failed/i),
    );

    // Multiple NULL idempotency keys should succeed
    await db.insert(discoveryJobs).values([
      {
        id: 'job_null_key_a',
        sourceId: 'src_fixture_osm',
        jobType: 'targeted_lookup',
        country: 'Nigeria',
        status: 'queued',
        priority: 50,
        idempotencyKey: null,
        createdAt: now + 2000,
        updatedAt: now + 2000,
      },
      {
        id: 'job_null_key_b',
        sourceId: 'src_fixture_osm',
        jobType: 'targeted_lookup',
        country: 'Nigeria',
        status: 'queued',
        priority: 50,
        idempotencyKey: null,
        createdAt: now + 3000,
        updatedAt: now + 3000,
      },
    ]);

    // 5. Nullable business contact fields stored cleanly without fake defaults
    await db.insert(discoveredBusinesses).values({
      id: 'cand_1',
      sourceId: 'src_fixture_osm',
      sourceRecordId: 'node/100001',
      sourceRecordType: 'osm_node',
      sourceUrl: 'https://openmap.fixture.example/node/100001',
      name: 'Ikeja Community Clinic',
      normalizedName: 'ikeja community clinic',
      category: 'Health',
      subcategory: 'Clinic',
      country: 'Nigeria',
      state: 'Lagos',
      lga: 'Ikeja',
      city: null,
      address: null,
      phone: null,
      secondaryPhone: null,
      email: null,
      website: null,
      latitude: 6.6018,
      longitude: 3.3515,
      openingHours: null,
      description: null,
      rawSourceDataJson: JSON.stringify({ amenity: 'clinic', name: 'Ikeja Community Clinic' }),
      normalizedDataJson: JSON.stringify({ category: 'Health' }),
      identityHash: 'sha256_fixture_ikeja_clinic',
      confidenceScore: 0.72,
      verificationStatus: 'unverified',
      reviewStatus: 'discovered',
      firstSeenAt: now,
      lastSeenAt: now,
      lastCheckedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const [storedCandidate] = await db
      .select()
      .from(discoveredBusinesses)
      .where(eq(discoveredBusinesses.id, 'cand_1'));
    assert.ok(storedCandidate);
    assert.equal(storedCandidate.phone, null);
    assert.equal(storedCandidate.email, null);
    assert.equal(storedCandidate.website, null);
    assert.equal(storedCandidate.address, null);
    assert.equal(storedCandidate.verificationStatus, 'unverified');
    assert.equal(storedCandidate.reviewStatus, 'discovered');

    // 6. Unique (source_id, source_record_id) constraint prevents duplicate imports from same source
    await assert.rejects(
      async () => {
        await db.insert(discoveredBusinesses).values({
          id: 'cand_1_duplicate',
          sourceId: 'src_fixture_osm',
          sourceRecordId: 'node/100001',
          name: 'Ikeja Community Clinic Duplicate',
          normalizedName: 'ikeja community clinic duplicate',
          country: 'Nigeria',
          confidenceScore: 0.5,
          verificationStatus: 'unverified',
          reviewStatus: 'discovered',
          firstSeenAt: now,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        });
      },
      matchesConstraint(/UNIQUE constraint failed/i),
    );

    // 7. DB CHECK constraints enforce valid confidence scores, statuses, coordinates, and timestamps
    await assert.rejects(
      async () => {
        await db.insert(discoveredBusinesses).values({
          id: 'cand_bad_conf',
          sourceId: 'src_fixture_osm',
          sourceRecordId: 'node/100002',
          name: 'Bad Confidence Biz',
          normalizedName: 'bad confidence biz',
          country: 'Nigeria',
          confidenceScore: 1.5,
          firstSeenAt: now,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        });
      },
      matchesConstraint(/CHECK constraint failed/i),
    );

    await assert.rejects(
      async () => {
        await db.insert(discoveredBusinesses).values({
          id: 'cand_bad_coords',
          sourceId: 'src_fixture_osm',
          sourceRecordId: 'node/100003',
          name: 'Half Coords Biz',
          normalizedName: 'half coords biz',
          country: 'Nigeria',
          latitude: 6.5,
          longitude: null,
          confidenceScore: 0.4,
          firstSeenAt: now,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        });
      },
      matchesConstraint(/CHECK constraint failed/i),
    );

    await assert.rejects(
      async () => {
        await db.insert(discoveredBusinesses).values({
          id: 'cand_bad_status_db',
          sourceId: 'src_fixture_osm',
          sourceRecordId: 'node/100004',
          name: 'Invalid Status Biz',
          normalizedName: 'invalid status biz',
          country: 'Nigeria',
          reviewStatus: 'auto_verified',
          confidenceScore: 0.4,
          firstSeenAt: now,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        });
      },
      matchesConstraint(/CHECK constraint failed/i),
    );

    // 8. Multiple append-only evidence records for the same candidate (and even the same field)
    await db.insert(businessEvidence).values([
      {
        id: 'ev_cand1_name_v1',
        discoveredBusinessId: 'cand_1',
        sourceId: 'src_fixture_osm',
        evidenceType: 'source_record',
        fieldName: 'name',
        evidenceValue: 'Ikeja Community Clinic',
        sourceUrl: 'https://openmap.fixture.example/node/100001',
        sourceRecordId: 'node/100001',
        sourceTimestamp: now - 10_000,
        collectedAt: now,
        confidence: 0.72,
        licenceReference: 'ODbL-1.0',
        attributionText: 'Fixture Open Map contributors',
        notes: 'Initial discovery snapshot',
        createdAt: now,
      },
      {
        id: 'ev_cand1_name_v2',
        discoveredBusinessId: 'cand_1',
        sourceId: 'src_fixture_registry',
        evidenceType: 'corroboration',
        fieldName: 'name',
        evidenceValue: 'Ikeja Community Clinic Ltd',
        sourceUrl: 'https://registry.fixture.example/record/4421',
        sourceRecordId: 'record/4421',
        sourceTimestamp: now,
        collectedAt: now + 5_000,
        confidence: 0.88,
        licenceReference: 'Public Open Government Licence',
        attributionText: 'Fixture Secondary Registry',
        notes: 'Corroborated without overwriting initial evidence',
        createdAt: now + 5_000,
      },
      {
        id: 'ev_cand1_coords',
        discoveredBusinessId: 'cand_1',
        sourceId: 'src_fixture_osm',
        evidenceType: 'geocode',
        fieldName: 'coordinates',
        evidenceValue: '6.6018,3.3515',
        sourceUrl: 'https://openmap.fixture.example/node/100001',
        sourceRecordId: 'node/100001',
        collectedAt: now,
        confidence: 0.9,
        createdAt: now,
      },
    ]);

    const evidenceRows = await db
      .select()
      .from(businessEvidence)
      .where(eq(businessEvidence.discoveredBusinessId, 'cand_1'));
    assert.equal(evidenceRows.length, 3);
    assert.equal(
      evidenceRows.filter((e) => e.fieldName === 'name').length,
      2,
      'Old evidence must not be overwritten when new evidence is collected',
    );

    // 9. Foreign key ON DELETE RESTRICT on discovery_sources protects provenance
    await assert.rejects(
      async () => {
        await db.delete(discoverySources).where(eq(discoverySources.id, 'src_fixture_osm'));
      },
      matchesConstraint(/FOREIGN KEY constraint failed/i),
    );

    // 10. Deleting a candidate cascades its evidence rows cleanly
    await db.delete(discoveredBusinesses).where(eq(discoveredBusinesses.id, 'cand_1'));
    const remainingEvidence = await db
      .select()
      .from(businessEvidence)
      .where(eq(businessEvidence.discoveredBusinessId, 'cand_1'));
    assert.equal(remainingEvidence.length, 0);

    // 11. Existing member directory `businesses` table remains completely untouched (0 rows)
    const bizCount = await d1
      .prepare('SELECT COUNT(*) AS count FROM businesses')
      .first<{ count: number }>();
    assert.equal(Number(bizCount?.count ?? -1), 0);
  } finally {
    await proxy.dispose();
  }
});
