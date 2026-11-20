export interface KvHealthResult {
  configured: boolean;
  connected: boolean;
  mode: 'kv' | 'memory-fallback';
  latencyMs: number;
  error?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface MemoryRateBucket {
  count: number;
  resetAt: number;
}

const MAX_MEMORY_BUCKETS = 5_000;
const memoryRateStore = new Map<string, MemoryRateBucket>();

function pruneMemoryBuckets(nowSec: number): void {
  for (const [bucketKey, entry] of memoryRateStore.entries()) {
    if (entry.resetAt <= nowSec) {
      memoryRateStore.delete(bucketKey);
    }
  }
  while (memoryRateStore.size >= MAX_MEMORY_BUCKETS) {
    const oldestKey = memoryRateStore.keys().next().value;
    if (!oldestKey) break;
    memoryRateStore.delete(oldestKey);
  }
}

export function resetMemoryRateLimitStore(): void {
  memoryRateStore.clear();
}

/**
 * Fixed-window rate limiter backed by Cloudflare KV (used for abuse-sensitive
 * endpoints such as auth, uploads, contact forms, and public write APIs).
 *
 * When `RATE_LIMIT_KV` is bound, counters are stored in KV across edge PoPs.
 * When `RATE_LIMIT_KV` is unbound (e.g. lightweight local dev or unit tests),
 * falls back to a bounded per-isolate in-memory fixed window instead of
 * silently disabling rate limiting.
 */
export async function checkRateLimit(
  kv: KVNamespace | undefined,
  key: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const windowBucket = Math.floor(nowSec / windowSeconds);
  const resetAt = (windowBucket + 1) * windowSeconds;
  const bucketKey = `rl:${key}:${windowBucket}`;

  if (!kv) {
    if (memoryRateStore.size >= MAX_MEMORY_BUCKETS) {
      pruneMemoryBuckets(nowSec);
    }
    const existing = memoryRateStore.get(bucketKey);
    const current = existing && existing.resetAt > nowSec ? existing.count : 0;

    if (current >= maxRequests) {
      return { allowed: false, remaining: 0, resetAt };
    }

    const next = current + 1;
    memoryRateStore.set(bucketKey, { count: next, resetAt });

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - next),
      resetAt,
    };
  }

  const currentRaw = await kv.get(bucketKey);
  const current = currentRaw ? Number.parseInt(currentRaw, 10) || 0 : 0;

  if (current >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt };
  }

  const next = current + 1;
  // Minimum KV TTL is 60 seconds.
  const ttl = Math.max(60, windowSeconds * 2);
  await kv.put(bucketKey, String(next), { expirationTtl: ttl });

  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - next),
    resetAt,
  };
}

export async function checkKvHealth(kv: KVNamespace | undefined): Promise<KvHealthResult> {
  if (!kv) {
    return {
      configured: false,
      connected: false,
      mode: 'memory-fallback',
      latencyMs: 0,
    };
  }
  const started = Date.now();
  try {
    await kv.get('health:ping');
    return {
      configured: true,
      connected: true,
      mode: 'kv',
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      mode: 'kv',
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : 'KV check failed',
    };
  }
}
