export interface KvHealthResult {
  configured: boolean;
  connected: boolean;
  latencyMs: number;
  error?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Fixed-window rate limiter backed by Cloudflare KV (used only for abuse-sensitive
 * public endpoints such as contact forms, newsletter signups, and auth/uploads).
 * Note: KV is eventually consistent (~60s globally), which is appropriate for
 * coarse edge throttling without adding D1 write load.
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

  if (!kv) {
    return { allowed: true, remaining: maxRequests, resetAt };
  }

  const bucketKey = `rl:${key}:${windowBucket}`;
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
    return { configured: false, connected: false, latencyMs: 0 };
  }
  const started = Date.now();
  try {
    await kv.get('health:ping');
    return { configured: true, connected: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : 'KV check failed',
    };
  }
}
