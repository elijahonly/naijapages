import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './index';
import { checkRateLimit } from './lib/kv';
import { normalizeMediaKey } from './lib/r2';
import { parseAllowedOrigins } from './middleware/cors';
import type { Bindings } from './types';

function createMockDb(options?: { tableCount?: number; fail?: boolean }): D1Database {
  const tableCount = options?.tableCount ?? 18;
  return {
    prepare(query: string) {
      return {
        bind() {
          return this;
        },
        async first<T = unknown>() {
          if (options?.fail) {
            throw new Error('D1 unavailable');
          }
          if (query.includes('sqlite_master')) {
            return { count: tableCount } as T;
          }
          if (query.includes('FROM media_objects')) {
            return null as T;
          }
          return { ok: 1 } as T;
        },
        async all() {
          return { results: [], success: true, meta: {} };
        },
        async run() {
          return { results: [], success: true, meta: {} };
        },
        async raw() {
          return [];
        },
      } as unknown as D1PreparedStatement;
    },
    async dump() {
      return new ArrayBuffer(0);
    },
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
  } as unknown as D1Database;
}

function createMockBucket(objects: Record<string, { body: string; contentType: string }> = {}): R2Bucket {
  return {
    async list() {
      return { objects: [], truncated: false, delimitedPrefixes: [] };
    },
    async get(key: string) {
      const entry = objects[key];
      if (!entry) return null;
      return {
        key,
        httpEtag: '"test-etag"',
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(entry.body));
            controller.close();
          },
        }),
        writeHttpMetadata(headers: Headers) {
          headers.set('content-type', entry.contentType);
        },
      };
    },
  } as unknown as R2Bucket;
}

function createMockKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
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
}

function createTestBindings(overrides: Partial<Bindings> = {}): Bindings {
  return {
    DB: createMockDb(),
    MEDIA_BUCKET: createMockBucket({
      'logos/demo.txt': { body: 'naijapages-media', contentType: 'text/plain' },
    }),
    RATE_LIMIT_KV: createMockKv(),
    APP_ENV: 'development',
    APP_NAME: 'NaijaPages',
    APP_URL: 'http://localhost:8787',
    CORS_ORIGINS: 'http://localhost:3000,http://127.0.0.1:8787',
    REQUIRE_VERIFIED_EMAIL: 'true',
    R2_PUBLIC_BASE_URL: '',
    ...overrides,
  };
}

test('normalizeMediaKey rejects traversal and accepts safe nested keys', () => {
  assert.equal(normalizeMediaKey('businesses/123/logo.webp'), 'businesses/123/logo.webp');
  assert.equal(normalizeMediaKey('/logos/demo.png'), 'logos/demo.png');
  assert.equal(normalizeMediaKey('../etc/passwd'), null);
  assert.equal(normalizeMediaKey('businesses//logo.png'), null);
  assert.equal(normalizeMediaKey(''), null);
});

test('parseAllowedOrigins splits and trims comma-separated origins', () => {
  assert.deepEqual(
    parseAllowedOrigins('http://localhost:3000, https://naijapages.ng , '),
    ['http://localhost:3000', 'https://naijapages.ng'],
  );
  assert.deepEqual(parseAllowedOrigins(undefined), []);
});

test('checkRateLimit enforces maxRequests within fixed KV window', async () => {
  const kv = createMockKv();
  const first = await checkRateLimit(kv, '127.0.0.1', 2, 60);
  const second = await checkRateLimit(kv, '127.0.0.1', 2, 60);
  const third = await checkRateLimit(kv, '127.0.0.1', 2, 60);

  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
});

test('GET /api/health returns service status and security headers', async () => {
  const app = createApp();
  const res = await app.request('http://localhost:8787/api/health', {}, createTestBindings());
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('x-request-id'));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');

  const json = (await res.json()) as { ok: boolean; data: { service: string; status: string } };
  assert.equal(json.ok, true);
  assert.equal(json.data.service, 'naijapages-worker');
  assert.equal(json.data.status, 'ok');
});

test('GET /api/health/bindings reports healthy D1, R2, and KV bindings', async () => {
  const app = createApp();
  const res = await app.request(
    'http://localhost:8787/api/health/bindings',
    {},
    createTestBindings(),
  );
  assert.equal(res.status, 200);

  const json = (await res.json()) as {
    ok: boolean;
    data: {
      healthy: boolean;
      bindings: {
        d1: { connected: boolean; schemaReady: boolean; tableCount: number };
        r2: { connected: boolean };
        kv: { configured: boolean; connected: boolean };
      };
    };
  };
  assert.equal(json.ok, true);
  assert.equal(json.data.healthy, true);
  assert.equal(json.data.bindings.d1.connected, true);
  assert.equal(json.data.bindings.d1.schemaReady, true);
  assert.equal(json.data.bindings.d1.tableCount, 18);
  assert.equal(json.data.bindings.r2.connected, true);
  assert.equal(json.data.bindings.kv.configured, true);
  assert.equal(json.data.bindings.kv.connected, true);
});

test('GET /api/health/bindings returns 503 when D1 check fails', async () => {
  const app = createApp();
  const res = await app.request(
    'http://localhost:8787/api/health/bindings',
    {},
    createTestBindings({ DB: createMockDb({ fail: true }) }),
  );
  assert.equal(res.status, 503);
  const json = (await res.json()) as { data: { healthy: boolean } };
  assert.equal(json.data.healthy, false);
});

test('GET /api/v1/status, /api/auth/providers, and legacy v1/auth stubs respond cleanly', async () => {
  const app = createApp();
  const env = createTestBindings();

  const statusRes = await app.request('http://localhost:8787/api/v1/status', {}, env);
  assert.equal(statusRes.status, 200);
  const statusJson = (await statusRes.json()) as {
    data: { phase: string; authMigrated: boolean; dataMigrated: boolean; storageMigrated: boolean };
  };
  assert.equal(statusJson.data.phase, 'phase-5-r2-migrated');
  assert.equal(statusJson.data.authMigrated, true);
  assert.equal(statusJson.data.dataMigrated, true);
  assert.equal(statusJson.data.storageMigrated, true);

  const providersRes = await app.request('http://localhost:8787/api/auth/providers', {}, env);
  assert.equal(providersRes.status, 200);
  const providersJson = (await providersRes.json()) as {
    data: { emailPassword: boolean; google: boolean; requireVerifiedEmail: boolean };
  };
  assert.equal(providersJson.data.emailPassword, true);
  assert.equal(providersJson.data.google, false);
  assert.equal(providersJson.data.requireVerifiedEmail, true);

  const authStubRes = await app.request('http://localhost:8787/api/v1/auth/session', {}, env);
  assert.equal(authStubRes.status, 404);
  const authStubJson = (await authStubRes.json()) as { ok: boolean; error: { code: string } };
  assert.equal(authStubJson.ok, false);
  assert.equal(authStubJson.error.code, 'MOVED_TO_BETTER_AUTH');

  const categoriesRes = await app.request('http://localhost:8787/api/v1/directory/categories', {}, env);
  assert.equal(categoriesRes.status, 200);

  const missingRes = await app.request('http://localhost:8787/api/nonexistent', {}, env);
  assert.equal(missingRes.status, 404);
});

test('GET /api/media serves valid R2 objects and rejects bad keys', async () => {
  const app = createApp();
  const env = createTestBindings();

  const okRes = await app.request('http://localhost:8787/api/media/logos/demo.txt', {}, env);
  assert.equal(okRes.status, 200);
  assert.equal(await okRes.text(), 'naijapages-media');
  assert.equal(okRes.headers.get('etag'), '"test-etag"');

  const missingRes = await app.request('http://localhost:8787/api/media/logos/missing.png', {}, env);
  assert.equal(missingRes.status, 404);

  const badRes = await app.request('http://localhost:8787/api/media/bad..key.png', {}, env);
  assert.equal(badRes.status, 400);
});

test('CORS allows configured origins and omits disallowed origins', async () => {
  const app = createApp();
  const env = createTestBindings();

  const allowedRes = await app.request(
    'http://localhost:8787/api/health',
    { headers: { Origin: 'http://localhost:3000' } },
    env,
  );
  assert.equal(allowedRes.headers.get('access-control-allow-origin'), 'http://localhost:3000');

  const blockedRes = await app.request(
    'http://localhost:8787/api/health',
    { headers: { Origin: 'https://evil.example.com' } },
    env,
  );
  assert.equal(blockedRes.headers.get('access-control-allow-origin'), null);
});
