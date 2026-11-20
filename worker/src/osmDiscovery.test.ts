import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import {
  buildOverpassQuery,
  classifyOsmBusinessTags,
  computeRetryDelaySeconds,
  createDiscoveryJob,
  enqueueDiscoveryJob,
  ensureOsmDiscoverySourceRecord,
  getDiscoveryJob,
  getDiscoverySourceAdapter,
  handleDiscoveryQueueBatch,
  ingestDiscoveredCandidates,
  normalizeOsmElement,
  OSM_ATTRIBUTION,
  OSM_PILOT_LIMITS,
  OSM_SOURCE_ID,
  osmSourceAdapter,
  parseOverpassResponseJson,
  parseRetryAfterHeader,
  resolveOsmEndpoint,
  validateOsmBoundingBox,
  validateOsmQueryRequest,
  type OsmRawElement,
} from './services/discovery';
import type {
  Bindings,
  DiscoveryQueueBatch,
  DiscoveryQueueBinding,
  DiscoveryQueueMessage,
  DiscoveryQueueMessageItem,
} from './types';

const MIGRATION_SQLS = [
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0001_initial_schema.sql'), 'utf8'),
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0002_phase4_relational_data.sql'), 'utf8'),
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0003_phase5_r2_media.sql'), 'utf8'),
  fs.readFileSync(path.resolve(process.cwd(), 'worker/migrations/0004_business_discovery.sql'), 'utf8'),
];

const VICTORIA_ISLAND_BBOX = {
  south: 6.42,
  west: 3.4,
  north: 6.45,
  east: 3.45,
};

const FIXTURE_ENDPOINT = 'https://overpass.fixture.local/api/interpreter';

/** Representative Overpass JSON fixture containing nodes, ways, relations, and rejected non-business items. */
function buildVictoriaIslandFixture() {
  return {
    version: 0.6,
    generator: 'Overpass API Fixture',
    osm3s: {
      timestamp_osm_base: '2026-10-15T08:30:00Z',
    },
    elements: [
      {
        type: 'node',
        id: 1001001,
        lat: 6.4281,
        lon: 3.4219,
        timestamp: '2026-09-20T12:00:00Z',
        version: 4,
        tags: {
          name: 'Eko Heritage Pharmacy',
          amenity: 'pharmacy',
          phone: '+234 803 111 2222; +234 809 333 4444',
          website: 'https://ekoheritagepharmacy.example.ng',
          email: 'care@ekoheritagepharmacy.example.ng',
          opening_hours: 'Mo-Sa 08:00-20:00',
          'addr:housenumber': '14',
          'addr:street': 'Adeola Odeku Street',
          'addr:suburb': 'Victoria Island',
          'addr:city': 'Lagos',
          'addr:state': 'Lagos State',
          'addr:lga': 'Eti-Osa',
          'addr:postcode': '106104',
          brand: 'Eko Heritage',
          operator: 'Eko Heritage Health Ltd',
        },
      },
      {
        type: 'way',
        id: 2002002,
        center: { lat: 6.4315, lon: 3.4302 },
        timestamp: '2026-09-18T10:15:00Z',
        version: 2,
        tags: {
          name: 'Lagoon Bistro & Grill',
          amenity: 'restaurant',
          cuisine: 'nigerian',
          'addr:street': 'Ahmadu Bello Way',
          'addr:city': 'Lagos',
        },
      },
      {
        type: 'relation',
        id: 3003003,
        bounds: {
          minlat: 6.433,
          minlon: 3.425,
          maxlat: 6.435,
          maxlon: 3.427,
        },
        timestamp: '2026-09-10T09:00:00Z',
        version: 1,
        tags: {
          'name:en': 'Atlantic Trade Plaza',
          building: 'retail',
          shop: 'mall',
          'contact:phone': '+234 802 555 6666',
          'addr:state': 'Lagos',
        },
      },
      // Should be REJECTED: residential house
      {
        type: 'way',
        id: 4004004,
        center: { lat: 6.432, lon: 3.428 },
        tags: {
          name: 'Block 4 Residence',
          building: 'residential',
        },
      },
      // Should be REJECTED: non-business amenity (bench)
      {
        type: 'node',
        id: 5005005,
        lat: 6.431,
        lon: 3.429,
        tags: {
          name: 'Waterfront Bench',
          amenity: 'bench',
        },
      },
      // Should be REJECTED: missing name
      {
        type: 'node',
        id: 6006006,
        lat: 6.4305,
        lon: 3.4265,
        tags: {
          shop: 'supermarket',
        },
      },
      // Should be REJECTED: missing geometry on way
      {
        type: 'way',
        id: 7007007,
        tags: {
          name: 'Ghost Hardware Store',
          shop: 'hardware',
        },
      },
      // Should be REJECTED: coordinates outside Nigeria
      {
        type: 'node',
        id: 8008008,
        lat: 51.5074,
        lon: -0.1278,
        tags: {
          name: 'London Electronics',
          shop: 'electronics',
        },
      },
      // Should be REJECTED: unexpected element type
      {
        type: 'area',
        id: 9009009,
        lat: 6.431,
        lon: 3.429,
        tags: {
          name: 'Unexpected Area Feature',
          shop: 'bakery',
        },
      },
    ],
  };
}

function createMockQueue(): {
  queue: DiscoveryQueueBinding;
  sent: Array<{ body: DiscoveryQueueMessage; delaySeconds?: number }>;
} {
  const sent: Array<{ body: DiscoveryQueueMessage; delaySeconds?: number }> = [];
  const queue = {
    async send(body: DiscoveryQueueMessage, options?: { delaySeconds?: number }) {
      sent.push({ body, delaySeconds: options?.delaySeconds });
    },
    async sendBatch(messages: Iterable<{ body: DiscoveryQueueMessage; delaySeconds?: number }>) {
      for (const m of messages) {
        sent.push({ body: m.body, delaySeconds: m.delaySeconds });
      }
    },
  } as unknown as DiscoveryQueueBinding;
  return { queue, sent };
}

interface MockMessageHandle {
  message: DiscoveryQueueMessageItem;
  acked: boolean;
  retried: boolean;
  retryDelaySeconds?: number;
}

function createMockMessage(
  body: unknown,
  opts: { id?: string; attempts?: number } = {},
): MockMessageHandle {
  const handle: MockMessageHandle = {
    acked: false,
    retried: false,
    retryDelaySeconds: undefined,
    message: null as unknown as DiscoveryQueueMessageItem,
  };
  handle.message = {
    id: opts.id ?? `msg_${crypto.randomUUID()}`,
    timestamp: new Date(),
    body: body as DiscoveryQueueMessage,
    attempts: opts.attempts ?? 1,
    ack() {
      handle.acked = true;
    },
    retry(retryOpts?: { delaySeconds?: number }) {
      handle.retried = true;
      handle.retryDelaySeconds = retryOpts?.delaySeconds;
    },
  };
  return handle;
}

function createMockBatch(handles: MockMessageHandle[]): DiscoveryQueueBatch {
  return {
    queue: 'naijapages-discovery-dev',
    messages: handles.map((h) => h.message),
    ackAll() {
      for (const h of handles) h.acked = true;
    },
    retryAll(retryOpts?: { delaySeconds?: number }) {
      for (const h of handles) {
        h.retried = true;
        h.retryDelaySeconds = retryOpts?.delaySeconds;
      }
    },
  };
}

function createMemoryKv(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

async function applyMigrations(db: D1Database) {
  for (const sql of MIGRATION_SQLS) {
    const statements = sql
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));
    for (const stmt of statements) {
      await db.prepare(stmt).run();
    }
  }
}

async function createTestPlatform() {
  const proxy = await getPlatformProxy<Bindings>({
    configPath: path.resolve(process.cwd(), 'wrangler.toml'),
    environment: 'development',
    persist: false,
  });
  await applyMigrations(proxy.env.DB);
  return proxy;
}

// ============================================================================
// 1. PURE UNIT TESTS: BBOX, ENDPOINT GUARDRAILS, TAG MAPPING, NORMALIZATION
// ============================================================================

test('OSM endpoint & bounding box guardrails reject missing, editing-API, outside-Nigeria, and oversized queries', () => {
  // Unconfigured endpoint fails cleanly without falling back to any public endpoint
  assert.throws(() => resolveOsmEndpoint({}), /OSM_OVERPASS_URL is not configured/);

  // OSM editing API is strictly refused
  assert.throws(
    () => resolveOsmEndpoint({ OSM_OVERPASS_URL: 'https://api.openstreetmap.org/api/0.6/map' }),
    /editing API/,
  );

  // Valid Overpass endpoint passes
  assert.equal(
    resolveOsmEndpoint({ OSM_OVERPASS_URL: FIXTURE_ENDPOINT }),
    FIXTURE_ENDPOINT,
  );

  // Inverted bbox rejected
  assert.throws(
    () => validateOsmBoundingBox({ south: 6.5, west: 3.4, north: 6.4, east: 3.5 }),
    /south < north/,
  );

  // Outside Nigeria rejected
  assert.throws(
    () => validateOsmBoundingBox({ south: 51.4, west: -0.2, north: 51.6, east: 0.0 }),
    /Nigeria geographic bounds/,
  );

  // Nationwide / oversized bbox rejected
  assert.throws(
    () => validateOsmBoundingBox({ south: 4.5, west: 3.0, north: 13.5, east: 14.0 }),
    /too large/,
  );

  // Max results above hard cap rejected
  assert.throws(
    () =>
      validateOsmQueryRequest({
        bbox: VICTORIA_ISLAND_BBOX,
        maxResults: OSM_PILOT_LIMITS.maxResultsHardCap + 1,
      }),
    /maxResults/,
  );

  // Valid small Nigeria pilot query builds bounded Overpass QL
  const validated = validateOsmQueryRequest({
    bbox: VICTORIA_ISLAND_BBOX,
    state: 'Lagos',
    lga: 'Eti-Osa',
    maxResults: 25,
  });
  const ql = buildOverpassQuery(validated, { timeoutSeconds: 15, maxSizeBytes: 1_000_000 });
  assert.match(ql, /\[out:json\]\[timeout:15\]\[maxsize:1000000\]\[bbox:6\.420000,3\.400000,6\.450000,3\.450000\]/);
  assert.match(ql, /out center tags meta 25;/);
});

test('OSM tag classification maps authentic business categories and rejects residential / non-business objects', () => {
  assert.deepEqual(classifyOsmBusinessTags({ amenity: 'pharmacy' }), {
    category: 'Health',
    subcategory: 'amenity:pharmacy',
    matchedTagKey: 'amenity',
    matchedTagValue: 'pharmacy',
  });
  assert.deepEqual(classifyOsmBusinessTags({ shop: 'electronics' }), {
    category: 'Tech',
    subcategory: 'shop:electronics',
    matchedTagKey: 'shop',
    matchedTagValue: 'electronics',
  });
  assert.deepEqual(classifyOsmBusinessTags({ tourism: 'hotel' }), {
    category: 'Hotels',
    subcategory: 'tourism:hotel',
    matchedTagKey: 'tourism',
    matchedTagValue: 'hotel',
  });
  assert.deepEqual(classifyOsmBusinessTags({ office: 'accountant' }), {
    category: 'Finance',
    subcategory: 'office:accountant',
    matchedTagKey: 'office',
    matchedTagValue: 'accountant',
  });
  assert.deepEqual(classifyOsmBusinessTags({ craft: 'carpenter' }), {
    category: 'Artisans',
    subcategory: 'craft:carpenter',
    matchedTagKey: 'craft',
    matchedTagValue: 'carpenter',
  });
  assert.deepEqual(classifyOsmBusinessTags({ building: 'supermarket' }), {
    category: 'Retail',
    subcategory: 'building:supermarket',
    matchedTagKey: 'building',
    matchedTagValue: 'supermarket',
  });

  // Non-business / residential tags rejected
  assert.equal(classifyOsmBusinessTags({ building: 'house' }), null);
  assert.equal(classifyOsmBusinessTags({ building: 'residential' }), null);
  assert.equal(classifyOsmBusinessTags({ building: 'apartments' }), null);
  assert.equal(classifyOsmBusinessTags({ building: 'yes' }), null);
  assert.equal(classifyOsmBusinessTags({ amenity: 'bench' }), null);
  assert.equal(classifyOsmBusinessTags({ amenity: 'waste_basket' }), null);
  assert.equal(classifyOsmBusinessTags({ amenity: 'toilets' }), null);
  assert.equal(classifyOsmBusinessTags({ shop: 'vacant' }), null);
});

test('OSM element normalization handles nodes, ways, relations, missing fields as null, and preserves raw OSM tags', () => {
  const fixture = buildVictoriaIslandFixture();

  // 1. Node with rich contact & Nigerian address fields
  const nodeRes = normalizeOsmElement(fixture.elements[0] as OsmRawElement);
  assert.equal(nodeRes.ok, true);
  if (nodeRes.ok) {
    assert.equal(nodeRes.candidate.sourceRecordId, 'node/1001001');
    assert.equal(nodeRes.candidate.sourceRecordType, 'osm_node');
    assert.equal(nodeRes.candidate.sourceUrl, 'https://www.openstreetmap.org/node/1001001');
    assert.equal(nodeRes.candidate.name, 'Eko Heritage Pharmacy');
    assert.equal(nodeRes.candidate.category, 'Health');
    assert.equal(nodeRes.candidate.subcategory, 'amenity:pharmacy');
    assert.equal(nodeRes.candidate.state, 'Lagos');
    assert.equal(nodeRes.candidate.lga, 'Eti-Osa');
    assert.equal(nodeRes.candidate.city, 'Lagos');
    assert.equal(nodeRes.candidate.address, '14 Adeola Odeku Street, Victoria Island, Lagos');
    assert.equal(nodeRes.candidate.phone, '+234 803 111 2222');
    assert.equal(nodeRes.candidate.secondaryPhone, '+234 809 333 4444');
    assert.equal(nodeRes.candidate.website, 'https://ekoheritagepharmacy.example.ng');
    assert.equal(nodeRes.candidate.email, 'care@ekoheritagepharmacy.example.ng');
    assert.equal(nodeRes.candidate.openingHours, 'Mo-Sa 08:00-20:00');
    assert.equal(nodeRes.candidate.brand, 'Eko Heritage');
    assert.equal(nodeRes.candidate.operator, 'Eko Heritage Health Ltd');
    assert.ok(nodeRes.candidate.confidenceScore <= 0.65);
    assert.equal(
      (nodeRes.candidate.normalizedData.osmTags as Record<string, string>).amenity,
      'pharmacy',
    );
  }

  // 2. Way using `center` coordinates; missing phone/website/email/state/lga stay strictly null
  const wayRes = normalizeOsmElement(fixture.elements[1] as OsmRawElement);
  assert.equal(wayRes.ok, true);
  if (wayRes.ok) {
    assert.equal(wayRes.candidate.sourceRecordId, 'way/2002002');
    assert.equal(wayRes.candidate.sourceRecordType, 'osm_way');
    assert.equal(wayRes.candidate.latitude, 6.4315);
    assert.equal(wayRes.candidate.longitude, 3.4302);
    assert.equal(wayRes.candidate.category, 'Food');
    assert.equal(wayRes.candidate.phone, null);
    assert.equal(wayRes.candidate.secondaryPhone, null);
    assert.equal(wayRes.candidate.website, null);
    assert.equal(wayRes.candidate.email, null);
    assert.equal(wayRes.candidate.state, null);
    assert.equal(wayRes.candidate.lga, null);
    assert.equal(wayRes.candidate.openingHours, null);
  }

  // 3. Relation using `bounds` center fallback and `name:en`
  const relRes = normalizeOsmElement(fixture.elements[2] as OsmRawElement);
  assert.equal(relRes.ok, true);
  if (relRes.ok) {
    assert.equal(relRes.candidate.sourceRecordId, 'relation/3003003');
    assert.equal(relRes.candidate.name, 'Atlantic Trade Plaza');
    assert.equal(relRes.candidate.latitude, 6.434);
    assert.equal(relRes.candidate.longitude, 3.426);
    assert.equal(relRes.candidate.category, 'Retail');
    assert.equal(relRes.candidate.phone, '+234 802 555 6666');
  }

  // 4. Rejections
  assert.deepEqual(normalizeOsmElement(fixture.elements[3] as OsmRawElement), {
    ok: false,
    reason: 'non_business_feature',
  });
  assert.deepEqual(normalizeOsmElement(fixture.elements[4] as OsmRawElement), {
    ok: false,
    reason: 'non_business_feature',
  });
  assert.deepEqual(normalizeOsmElement(fixture.elements[5] as OsmRawElement), {
    ok: false,
    reason: 'missing_name',
  });
  assert.deepEqual(normalizeOsmElement(fixture.elements[6] as OsmRawElement), {
    ok: false,
    reason: 'missing_geometry',
  });
  assert.deepEqual(normalizeOsmElement(fixture.elements[7] as OsmRawElement), {
    ok: false,
    reason: 'invalid_coordinates',
  });
  assert.deepEqual(normalizeOsmElement(fixture.elements[8] as OsmRawElement), {
    ok: false,
    reason: 'unexpected_element_type',
  });
  assert.deepEqual(
    normalizeOsmElement({ type: 'node', id: 99, lat: 6.43, lon: 3.42 } as OsmRawElement),
    { ok: false, reason: 'missing_tags' },
  );
});

// ============================================================================
// 2. HTTP ERROR, RATE-LIMIT, TIMEOUT, SIZE LIMIT, JSON & CACHING TESTS
// ============================================================================

test('OSM adapter handles HTTP 429 (Retry-After), 400/403/404, 5xx, timeouts, malformed JSON, oversized bodies, and KV caching', async () => {
  const baseEnv: Partial<Bindings> = {
    OSM_OVERPASS_URL: FIXTURE_ENDPOINT,
    OSM_USER_AGENT: 'NaijaPagesDiscoveryTest/1.0 (+https://naijapages.ng)',
    OSM_REQUEST_TIMEOUT_MS: '5000',
    OSM_MAX_RESPONSE_BYTES: '65536',
  };

  // parseRetryAfterHeader supports seconds and HTTP-date
  assert.equal(parseRetryAfterHeader('90'), 90);
  const now = Date.UTC(2026, 9, 15, 10, 0, 0);
  assert.equal(parseRetryAfterHeader('Thu, 15 Oct 2026 10:02:30 GMT', now), 150);

  // Jittered backoff bounds check
  const jittered = computeRetryDelaySeconds(1, {
    retryAfterSeconds: 90,
    jitterRatio: 0.15,
    randomFn: () => 0.99,
  });
  assert.ok(jittered >= 90 && jittered <= 104);

  // HTTP 429 rate_limited preserves Retry-After
  await assert.rejects(
    () =>
      osmSourceAdapter.discover({ bbox: VICTORIA_ISLAND_BBOX }, baseEnv, {
        fetchImpl: async () =>
          new Response('Too Many Requests', {
            status: 429,
            headers: { 'Retry-After': '180' },
          }),
        skipCache: true,
      }),
    (err: unknown) => {
      const c = osmSourceAdapter.classifyError(err);
      assert.equal(c.kind, 'rate_limited');
      assert.equal(c.retryable, true);
      assert.equal(c.retryAfterSeconds, 180);
      return true;
    },
  );

  // Permanent HTTP 400 / 403 / 404
  for (const status of [400, 403, 404]) {
    await assert.rejects(
      () =>
        osmSourceAdapter.discover({ bbox: VICTORIA_ISLAND_BBOX }, baseEnv, {
          fetchImpl: async () => new Response(`Err ${status}`, { status }),
          skipCache: true,
        }),
      (err: unknown) => {
        const c = osmSourceAdapter.classifyError(err);
        assert.equal(c.kind, 'permanent');
        assert.equal(c.retryable, false);
        return true;
      },
    );
  }

  // Transient HTTP 500 / 502 / 503 / 504
  for (const status of [500, 502, 503, 504]) {
    await assert.rejects(
      () =>
        osmSourceAdapter.discover({ bbox: VICTORIA_ISLAND_BBOX }, baseEnv, {
          fetchImpl: async () => new Response(`Server ${status}`, { status }),
          skipCache: true,
        }),
      (err: unknown) => {
        const c = osmSourceAdapter.classifyError(err);
        assert.equal(c.kind, 'transient');
        assert.equal(c.retryable, true);
        return true;
      },
    );
  }

  // AbortError / timeout classified as transient
  await assert.rejects(
    () =>
      osmSourceAdapter.discover({ bbox: VICTORIA_ISLAND_BBOX }, baseEnv, {
        fetchImpl: async () => {
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        },
        skipCache: true,
      }),
    (err: unknown) => {
      const c = osmSourceAdapter.classifyError(err);
      assert.equal(c.kind, 'transient');
      assert.equal(c.code, 'OSM_TIMEOUT');
      return true;
    },
  );

  // Malformed JSON and missing `elements` rejected cleanly
  assert.throws(() => parseOverpassResponseJson('{not valid json'), /not valid JSON/);
  assert.throws(() => parseOverpassResponseJson('{"version":0.6}'), /missing the `elements` array/);

  // Oversized response rejected via Content-Length and streaming body
  await assert.rejects(
    () =>
      osmSourceAdapter.discover({ bbox: VICTORIA_ISLAND_BBOX }, baseEnv, {
        fetchImpl: async () =>
          new Response('{}', {
            status: 200,
            headers: { 'Content-Length': '9999999' },
          }),
        skipCache: true,
      }),
    /exceeds limit/,
  );

  await assert.rejects(
    () =>
      osmSourceAdapter.discover(
        { bbox: VICTORIA_ISLAND_BBOX },
        { ...baseEnv, OSM_MAX_RESPONSE_BYTES: '16384' },
        {
          fetchImpl: async () =>
            new Response(JSON.stringify({ elements: [], pad: 'x'.repeat(25_000) }), {
              status: 200,
            }),
          skipCache: true,
        },
      ),
    /exceeded maximum allowed size/,
  );

  // KV caching avoids repeating identical Overpass queries & sends honest User-Agent
  const { kv } = createMemoryKv();
  let fetchCount = 0;
  let observedUserAgent = '';
  const fixtureBody = JSON.stringify(buildVictoriaIslandFixture());
  const cachedFetch: typeof fetch = async (_url, init) => {
    fetchCount += 1;
    const headers = init?.headers as Record<string, string>;
    observedUserAgent = headers?.['User-Agent'] ?? '';
    return new Response(fixtureBody, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const first = await osmSourceAdapter.discover(
    { bbox: VICTORIA_ISLAND_BBOX },
    { ...baseEnv, RATE_LIMIT_KV: kv },
    { fetchImpl: cachedFetch, now },
  );
  assert.equal(fetchCount, 1);
  assert.equal(first.cached, false);
  assert.equal(first.candidates.length, 3);
  assert.equal(first.rejectedCount, 6);
  assert.equal(observedUserAgent, 'NaijaPagesDiscoveryTest/1.0 (+https://naijapages.ng)');

  const second = await osmSourceAdapter.discover(
    { bbox: VICTORIA_ISLAND_BBOX },
    { ...baseEnv, RATE_LIMIT_KV: kv },
    { fetchImpl: cachedFetch, now: now + 60_000 },
  );
  assert.equal(fetchCount, 1, 'Second identical query should be served from KV cache');
  assert.equal(second.cached, true);
  assert.equal(second.candidates.length, 3);
});

// ============================================================================
// 3. END-TO-END MINIFLARE D1 + QUEUE + OSM CONNECTOR INTEGRATION TESTS
// ============================================================================

test('End-to-end OSM queue execution stores unverified candidates, ODbL evidence, handles duplicates & tag diffs, and never touches public businesses table', async () => {
  const proxy = await createTestPlatform();
  try {
    const db = proxy.env.DB;
    const { queue, sent } = createMockQueue();

    // Verify adapter is registered
    assert.equal(getDiscoverySourceAdapter(OSM_SOURCE_ID), osmSourceAdapter);

    // 1. Default OSM source registration is pending_review & disabled
    await ensureOsmDiscoverySourceRecord(db, { baseUrl: FIXTURE_ENDPOINT });
    const initialSource = await db
      .prepare('SELECT id, licence_name, licence_url, attribution_text, permission_status, enabled FROM discovery_sources WHERE id = ?')
      .bind(OSM_SOURCE_ID)
      .first<{
        id: string;
        licence_name: string;
        licence_url: string;
        attribution_text: string;
        permission_status: string;
        enabled: number;
      }>();
    assert.ok(initialSource);
    assert.equal(initialSource.licence_name, OSM_ATTRIBUTION.licenceName);
    assert.equal(initialSource.licence_url, 'https://www.openstreetmap.org/copyright');
    assert.equal(initialSource.attribution_text, '© OpenStreetMap contributors');
    assert.equal(initialSource.permission_status, 'pending_review');
    assert.equal(initialSource.enabled, 0);

    // Explicitly approve & enable for pilot test
    await db
      .prepare(`UPDATE discovery_sources SET permission_status = 'approved', enabled = 1 WHERE id = ?`)
      .bind(OSM_SOURCE_ID)
      .run();

    const env: Bindings = {
      ...proxy.env,
      DISCOVERY_QUEUE: queue,
      DISCOVERY_ENABLED: 'true',
      DISCOVERY_DRY_RUN: 'false',
      DISCOVERY_MAX_ATTEMPTS: '3',
      OSM_OVERPASS_URL: FIXTURE_ENDPOINT,
      OSM_USER_AGENT: 'NaijaPagesDiscoveryTest/1.0 (+https://naijapages.ng)',
    };

    const t1 = Date.UTC(2026, 9, 15, 12, 0, 0);
    const job1 = await createDiscoveryJob(db, {
      sourceId: OSM_SOURCE_ID,
      jobType: 'lga_sweep',
      state: 'Lagos',
      lga: 'Eti-Osa',
      geographicFilter: { bbox: VICTORIA_ISLAND_BBOX },
      searchParameters: { maxResults: 50 },
      now: t1,
    });
    const enqueued1 = await enqueueDiscoveryJob(db, queue, job1.id, { now: t1 });
    assert.equal(sent.length, 1);

    const fixtureV1 = buildVictoriaIslandFixture();
    const fetchV1: typeof fetch = async () =>
      new Response(JSON.stringify(fixtureV1), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const msg1 = createMockMessage(enqueued1.message);
    const batchRes1 = await handleDiscoveryQueueBatch(createMockBatch([msg1]), env, undefined, {
      now: t1,
      fetchImpl: fetchV1,
      skipCache: true,
    });

    assert.equal(batchRes1.results[0].outcome, 'completed');
    assert.equal(msg1.acked, true);

    // Check D1 job counters
    const finishedJob1 = await getDiscoveryJob(db, job1.id);
    assert.ok(finishedJob1);
    assert.equal(finishedJob1.status, 'completed');
    assert.equal(finishedJob1.discoveredCount, 9);
    assert.equal(finishedJob1.acceptedCount, 3);
    assert.equal(finishedJob1.rejectedCount, 6);
    assert.equal(finishedJob1.duplicateCount, 0);

    // Check discovery_sources.last_successful_sync updated
    const healthySource = await db
      .prepare('SELECT last_successful_sync, last_error FROM discovery_sources WHERE id = ?')
      .bind(OSM_SOURCE_ID)
      .first<{ last_successful_sync: number | null; last_error: string | null }>();
    assert.equal(healthySource?.last_successful_sync, t1);
    assert.equal(healthySource?.last_error, null);

    // Check discovered_businesses rows are strictly unverified & needs_review
    const candidates = await db
      .prepare(
        `SELECT id, source_record_id, name, category, phone, verification_status, review_status, first_seen_at, last_seen_at
         FROM discovered_businesses
         WHERE source_id = ?
         ORDER BY source_record_id ASC`,
      )
      .bind(OSM_SOURCE_ID)
      .all<{
        id: string;
        source_record_id: string;
        name: string;
        category: string;
        phone: string | null;
        verification_status: string;
        review_status: string;
        first_seen_at: number;
        last_seen_at: number;
      }>();

    assert.equal(candidates.results.length, 3);
    for (const row of candidates.results) {
      assert.equal(row.verification_status, 'unverified');
      assert.equal(row.review_status, 'needs_review');
      assert.equal(row.first_seen_at, t1);
      assert.equal(row.last_seen_at, t1);
    }

    // Check ODbL attribution persisted on business_evidence rows
    const evidenceBefore = await db
      .prepare(
        `SELECT COUNT(*) AS cnt,
                MIN(attribution_text) AS attr,
                MIN(licence_reference) AS lic
         FROM business_evidence
         WHERE source_id = ?`,
      )
      .bind(OSM_SOURCE_ID)
      .first<{ cnt: number; attr: string; lic: string }>();
    assert.ok((evidenceBefore?.cnt ?? 0) >= 15);
    assert.equal(evidenceBefore?.attr, '© OpenStreetMap contributors');
    assert.match(evidenceBefore?.lic ?? '', /https:\/\/www\.openstreetmap\.org\/copyright/);

    // Verify public `businesses` table was NEVER touched
    const publicBizCount = await db
      .prepare('SELECT COUNT(*) AS cnt FROM businesses')
      .first<{ cnt: number }>();
    assert.equal(publicBizCount?.cnt, 0);

    // 2. Re-import with unchanged & updated OSM element:
    //    - Duplicate element updates last_seen_at without creating another candidate row
    //    - Changed tags append diff evidence without erasing earlier evidence
    const t2 = t1 + 3_600_000;
    const fixtureV2 = buildVictoriaIslandFixture();
    // Update Lagoon Bistro & Grill (way/2002002) with a newly mapped phone number & opening_hours
    (fixtureV2.elements[1] as { tags: Record<string, string> }).tags.phone = '+234 805 777 8888';
    (fixtureV2.elements[1] as { tags: Record<string, string> }).tags.opening_hours = 'Mo-Su 10:00-22:00';

    const batchV2 = await osmSourceAdapter.discover(
      { bbox: VICTORIA_ISLAND_BBOX, state: 'Lagos', lga: 'Eti-Osa' },
      env,
      {
        fetchImpl: async () => new Response(JSON.stringify(fixtureV2), { status: 200 }),
        now: t2,
        skipCache: true,
      },
    );

    const reimportSummary = await ingestDiscoveredCandidates(db, {
      attribution: OSM_ATTRIBUTION,
      candidates: batchV2.candidates,
      retrievedAt: t2,
      sourceDataTimestamp: batchV2.sourceDataTimestamp,
    });

    assert.equal(reimportSummary.acceptedCount, 0);
    assert.equal(reimportSummary.duplicateCount, 3);
    assert.equal(reimportSummary.updatedCount, 1);
    assert.ok(reimportSummary.evidenceInsertedCount >= 3); // osm_tags_diff + phone + opening_hours

    // Still strictly 3 candidates in D1, with last_seen_at advanced to t2
    const afterCandidates = await db
      .prepare(
        `SELECT source_record_id, phone, opening_hours, first_seen_at, last_seen_at, verification_status
         FROM discovered_businesses
         WHERE source_id = ?
         ORDER BY source_record_id ASC`,
      )
      .bind(OSM_SOURCE_ID)
      .all<{
        source_record_id: string;
        phone: string | null;
        opening_hours: string | null;
        first_seen_at: number;
        last_seen_at: number;
        verification_status: string;
      }>();

    assert.equal(afterCandidates.results.length, 3);
    for (const row of afterCandidates.results) {
      assert.equal(row.first_seen_at, t1);
      assert.equal(row.last_seen_at, t2);
      assert.equal(row.verification_status, 'unverified');
    }
    const updatedBistro = afterCandidates.results.find((r) => r.source_record_id === 'way/2002002');
    assert.equal(updatedBistro?.phone, '+234 805 777 8888');
    assert.equal(updatedBistro?.opening_hours, 'Mo-Su 10:00-22:00');

    // Earlier evidence preserved + new `osm_tags_diff` evidence appended
    const evidenceAfter = await db
      .prepare('SELECT COUNT(*) AS cnt FROM business_evidence WHERE source_id = ?')
      .bind(OSM_SOURCE_ID)
      .first<{ cnt: number }>();
    assert.equal(
      evidenceAfter?.cnt,
      (evidenceBefore?.cnt ?? 0) + reimportSummary.evidenceInsertedCount,
    );

    const diffRow = await db
      .prepare(
        `SELECT evidence_value, attribution_text
         FROM business_evidence
         WHERE source_id = ? AND field_name = 'osm_tags_diff'`,
      )
      .bind(OSM_SOURCE_ID)
      .first<{ evidence_value: string; attribution_text: string }>();
    assert.ok(diffRow);
    assert.equal(diffRow.attribution_text, '© OpenStreetMap contributors');
    const parsedDiff = JSON.parse(diffRow.evidence_value) as Record<
      string,
      { before: string | null; after: string | null }
    >;
    assert.deepEqual(parsedDiff.phone, { before: null, after: '+234 805 777 8888' });
    assert.deepEqual(parsedDiff.opening_hours, { before: null, after: 'Mo-Su 10:00-22:00' });

    // 3. Upstream HTTP 429 during queue execution records source failure and schedules retry with Retry-After
    const t3 = t2 + 60_000;
    const jobRateLimited = await createDiscoveryJob(db, {
      sourceId: OSM_SOURCE_ID,
      jobType: 'refresh',
      geographicFilter: { bbox: VICTORIA_ISLAND_BBOX },
      now: t3,
    });
    const enqueuedRL = await enqueueDiscoveryJob(db, queue, jobRateLimited.id, { now: t3 });
    const msgRL = createMockMessage(enqueuedRL.message, { attempts: 1 });

    const rlBatch = await handleDiscoveryQueueBatch(createMockBatch([msgRL]), env, undefined, {
      now: t3,
      skipCache: true,
      fetchImpl: async () =>
        new Response('Rate limit exceeded', {
          status: 429,
          headers: { 'Retry-After': '120' },
        }),
    });

    assert.equal(rlBatch.results[0].outcome, 'retried');
    assert.equal(msgRL.retried, true);
    assert.ok((msgRL.retryDelaySeconds ?? 0) >= 120);

    const failedSource = await db
      .prepare('SELECT last_failed_sync, last_error FROM discovery_sources WHERE id = ?')
      .bind(OSM_SOURCE_ID)
      .first<{ last_failed_sync: number | null; last_error: string | null }>();
    assert.equal(failedSource?.last_failed_sync, t3);
    assert.match(failedSource?.last_error ?? '', /HTTP 429/);
  } finally {
    await proxy.dispose();
  }
});
