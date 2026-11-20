/**
 * OpenStreetMap (OSM) Overpass-compatible discovery source adapter.
 *
 * Licensing & attribution:
 * - Data is licensed under Open Database License (ODbL) 1.0:
 *   https://www.openstreetmap.org/copyright
 * - Required attribution: `© OpenStreetMap contributors`
 * - See `docs/business-discovery/openstreetmap-source.md` for ODbL share-alike
 *   obligations and migration path away from public Overpass endpoints.
 *
 * Safety guardrails:
 * - Never hardcodes or silently calls a public Overpass endpoint when `OSM_OVERPASS_URL`
 *   (and `request.endpointUrl`) are unset.
 * - Rejects the OSM editing API (`/api/0.6/`).
 * - Requires an explicit bounded Nigeria bounding box (no full-country sweeps).
 * - Enforces conservative request timeouts, response size limits, in-isolate concurrency
 *   caps, honest User-Agent, KV response caching, and `Retry-After` handling.
 */
import { validateDiscoveryUrl } from '../../../lib/discoveryValidation';
import type { Bindings } from '../../../types';
import { classifyDiscoveryError, DiscoveryJobError } from '../errors';
import {
  normalizeOsmElement,
  validateOsmQueryRequest,
  type OsmRawElement,
} from './osmMapping';
import type {
  DiscoveryQueryRequest,
  DiscoverySourceAdapter,
  DiscoverySourceAdapterOptions,
  NormalizedDiscoveredCandidate,
  SourceAttribution,
  SourceDiscoveryBatchResult,
  SourceHealthCheckResult,
} from './types';

export const OSM_SOURCE_ID = 'openstreetmap_overpass';

export const OSM_ATTRIBUTION: SourceAttribution = {
  sourceId: OSM_SOURCE_ID,
  sourceName: 'OpenStreetMap (Overpass API)',
  sourceType: 'open_data',
  licenceName: 'Open Database License (ODbL) 1.0',
  licenceUrl: 'https://www.openstreetmap.org/copyright',
  attributionText: '© OpenStreetMap contributors',
  permittedUsage:
    'Discovery staging with mandatory attribution (© OpenStreetMap contributors, https://www.openstreetmap.org/copyright). ODbL share-alike obligations require legal review before distributing or mixing OSM-derived records into a proprietary database.',
};

const DEFAULT_OSM_USER_AGENT = 'NaijaPagesDiscovery/1.0 (+https://naijapages.ng)';
const DEFAULT_OSM_TIMEOUT_MS = 20_000;
const DEFAULT_OSM_MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MiB
const OSM_CACHE_TTL_SECONDS = 900; // 15 minutes
const MAX_CONCURRENT_OSM_REQUESTS = 1;

let activeOsmRequests = 0;

function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw || !raw.trim()) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function resolveOsmEndpoint(
  env: Partial<Bindings>,
  overrideEndpoint?: string | null,
): string {
  const raw = (overrideEndpoint ?? env.OSM_OVERPASS_URL ?? '').trim();
  if (!raw) {
    throw new DiscoveryJobError(
      'OSM_OVERPASS_URL is not configured. Configure a permitted Overpass-compatible endpoint before running an OSM discovery job.',
      {
        kind: 'permanent',
        code: 'OSM_ENDPOINT_NOT_CONFIGURED',
      },
    );
  }

  let validated: string;
  try {
    validated = validateDiscoveryUrl(raw, 'OSM_OVERPASS_URL', {
      required: true,
      httpsOnly: false,
    })!;
  } catch (err) {
    throw new DiscoveryJobError(
      err instanceof Error ? err.message : 'Invalid OSM_OVERPASS_URL.',
      {
        kind: 'permanent',
        code: 'INVALID_ENDPOINT_URL',
        cause: err,
      },
    );
  }

  // Explicitly refuse the OSM editing API (never use api.openstreetmap.org/api/0.6/* for discovery).
  const parsedUrl = new URL(validated);
  const hostLower = parsedUrl.hostname.toLowerCase();
  if (
    parsedUrl.pathname.toLowerCase().includes('/api/0.6') ||
    (hostLower === 'api.openstreetmap.org' && !parsedUrl.pathname.includes('interpreter'))
  ) {
    throw new DiscoveryJobError(
      'Refusing to call the OpenStreetMap editing API for bulk discovery. Use a permitted Overpass-compatible endpoint.',
      {
        kind: 'permanent',
        code: 'OSM_EDITING_API_FORBIDDEN',
      },
    );
  }

  return validated;
}

export function parseRetryAfterHeader(raw: string | null, nowMs: number = Date.now()): number | undefined {
  if (!raw || !raw.trim()) return undefined;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, seconds) : undefined;
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const delta = Math.ceil((dateMs - nowMs) / 1000);
    return delta > 0 ? Math.min(3600, delta) : undefined;
  }
  return undefined;
}

/**
 * Builds a bounded, conservative Overpass QL query for named business/service features
 * within an explicitly validated Nigeria bounding box.
 */
export function buildOverpassQuery(
  request: DiscoveryQueryRequest,
  opts: { timeoutSeconds?: number; maxSizeBytes?: number } = {},
): string {
  const { south, west, north, east } = request.bbox;
  const timeoutSec = Math.min(30, Math.max(5, Math.trunc(opts.timeoutSeconds ?? 15)));
  const maxSizeBytes = Math.min(
    10 * 1024 * 1024,
    Math.max(256 * 1024, Math.trunc(opts.maxSizeBytes ?? DEFAULT_OSM_MAX_RESPONSE_BYTES)),
  );
  // Overpass `out center tags meta <limit>` returns element metadata, tags, and center coordinates
  // for ways/relations while capping output count server-side.
  const serverLimit = Math.min(500, Math.max(1, request.maxResults));
  const bboxStr = `${south.toFixed(6)},${west.toFixed(6)},${north.toFixed(6)},${east.toFixed(6)}`;

  return [
    `[out:json][timeout:${timeoutSec}][maxsize:${maxSizeBytes}][bbox:${bboxStr}];`,
    '(',
    '  nwr["shop"]["name"];',
    '  nwr["amenity"]["name"];',
    '  nwr["office"]["name"];',
    '  nwr["craft"]["name"];',
    '  nwr["tourism"]["name"];',
    '  nwr["healthcare"]["name"];',
    '  nwr["leisure"]["name"];',
    '  nwr["industrial"]["name"];',
    '  nwr["building"~"^(hotel|hospital|clinic|school|college|university|kindergarten|supermarket|retail|kiosk|commercial|office|industrial|warehouse|service|bakehouse|restaurant)$"]["name"];',
    ');',
    `out center tags meta ${serverLimit};`,
  ].join('\n');
}

function buildCacheKey(endpoint: string, query: string): string {
  const raw = `${endpoint}|${query}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return `discovery:osm:cache:${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const declared = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new DiscoveryJobError(
        `Overpass response size (${declared} bytes) exceeds limit of ${maxBytes} bytes.`,
        {
          kind: 'permanent',
          code: 'OSM_RESPONSE_TOO_LARGE',
        },
      );
    }
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new DiscoveryJobError(
        `Overpass response exceeds maximum allowed size of ${maxBytes} bytes.`,
        {
          kind: 'permanent',
          code: 'OSM_RESPONSE_TOO_LARGE',
        },
      );
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new DiscoveryJobError(
        `Overpass response exceeded maximum allowed size of ${maxBytes} bytes.`,
        {
          kind: 'permanent',
          code: 'OSM_RESPONSE_TOO_LARGE',
        },
      );
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function classifyHttpFailure(
  status: number,
  retryAfterSeconds: number | undefined,
  snippet: string,
): DiscoveryJobError {
  const detail = snippet ? `: ${snippet.slice(0, 160)}` : '';
  if (status === 429) {
    return new DiscoveryJobError(`Overpass API rate limited (HTTP 429)${detail}`, {
      kind: 'rate_limited',
      code: 'OSM_RATE_LIMITED',
      retryAfterSeconds: retryAfterSeconds ?? 120,
    });
  }
  if (status === 400) {
    return new DiscoveryJobError(`Overpass API rejected query (HTTP 400)${detail}`, {
      kind: 'permanent',
      code: 'OSM_BAD_REQUEST',
    });
  }
  if (status === 403) {
    return new DiscoveryJobError(`Overpass API access forbidden (HTTP 403)${detail}`, {
      kind: 'permanent',
      code: 'OSM_FORBIDDEN',
    });
  }
  if (status === 404) {
    return new DiscoveryJobError(`Overpass API endpoint not found (HTTP 404)${detail}`, {
      kind: 'permanent',
      code: 'OSM_NOT_FOUND',
    });
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return new DiscoveryJobError(`Overpass API temporary server error (HTTP ${status})${detail}`, {
      kind: 'transient',
      code: `OSM_HTTP_${status}`,
      retryAfterSeconds,
    });
  }
  if (status >= 400 && status < 500) {
    return new DiscoveryJobError(`Overpass API client error (HTTP ${status})${detail}`, {
      kind: 'permanent',
      code: `OSM_HTTP_${status}`,
    });
  }
  return new DiscoveryJobError(`Overpass API upstream error (HTTP ${status})${detail}`, {
    kind: 'transient',
    code: `OSM_HTTP_${status}`,
    retryAfterSeconds,
  });
}

export interface ParsedOverpassPayload {
  elements: OsmRawElement[];
  sourceDataTimestamp: number | null;
}

export function parseOverpassResponseJson(rawText: string): ParsedOverpassPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new DiscoveryJobError('Overpass response is not valid JSON.', {
      kind: 'permanent',
      code: 'OSM_MALFORMED_JSON',
      cause: err,
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DiscoveryJobError('Overpass response root must be a JSON object.', {
      kind: 'permanent',
      code: 'OSM_MALFORMED_RESPONSE',
    });
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.elements)) {
    throw new DiscoveryJobError('Overpass response is missing the `elements` array.', {
      kind: 'permanent',
      code: 'OSM_MALFORMED_RESPONSE',
    });
  }

  let sourceDataTimestamp: number | null = null;
  if (obj.osm3s && typeof obj.osm3s === 'object' && !Array.isArray(obj.osm3s)) {
    const ts = (obj.osm3s as Record<string, unknown>).timestamp_osm_base;
    if (typeof ts === 'string') {
      const ms = Date.parse(ts);
      if (Number.isFinite(ms) && ms >= 0) {
        sourceDataTimestamp = Math.trunc(ms);
      }
    }
  }

  return {
    elements: obj.elements as OsmRawElement[],
    sourceDataTimestamp,
  };
}

export class OsmDiscoverySourceAdapter implements DiscoverySourceAdapter {
  readonly id = OSM_SOURCE_ID;
  readonly attribution = OSM_ATTRIBUTION;

  validateQuery(raw: Partial<DiscoveryQueryRequest>): DiscoveryQueryRequest {
    return validateOsmQueryRequest(raw);
  }

  classifyError(err: unknown) {
    return classifyDiscoveryError(err);
  }

  async healthCheck(
    env: Partial<Bindings>,
    opts: DiscoverySourceAdapterOptions = {},
  ): Promise<SourceHealthCheckResult> {
    const start = Date.now();
    let endpoint: string;
    try {
      endpoint = resolveOsmEndpoint(env);
    } catch (err) {
      return {
        ok: false,
        sourceId: this.id,
        endpoint: null,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : 'OSM endpoint is not configured.',
      };
    }

    const fetchFn = opts.fetchImpl ?? fetch;
    const timeoutMs = parsePositiveInt(env.OSM_REQUEST_TIMEOUT_MS, 10_000, 1_000, 30_000);
    const userAgent = (env.OSM_USER_AGENT || DEFAULT_OSM_USER_AGENT).trim();
    const statusUrl = endpoint.replace(/\/interpreter\/?$/i, '/status');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(statusUrl, {
        method: 'GET',
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/plain, application/json',
        },
        signal: controller.signal,
      });
      return {
        ok: res.ok,
        sourceId: this.id,
        endpoint: statusUrl,
        statusCode: res.status,
        latencyMs: Date.now() - start,
        message: res.ok ? 'Overpass endpoint reachable.' : `Overpass health check returned HTTP ${res.status}.`,
      };
    } catch (err) {
      return {
        ok: false,
        sourceId: this.id,
        endpoint: statusUrl,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : 'Overpass health check failed.',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async discover(
    rawRequest: Partial<DiscoveryQueryRequest>,
    env: Partial<Bindings>,
    opts: DiscoverySourceAdapterOptions = {},
  ): Promise<SourceDiscoveryBatchResult> {
    const request = this.validateQuery(rawRequest);
    const endpoint = resolveOsmEndpoint(env, request.endpointUrl);
    const now = opts.now ?? Date.now();
    const timeoutMs = parsePositiveInt(
      env.OSM_REQUEST_TIMEOUT_MS,
      DEFAULT_OSM_TIMEOUT_MS,
      1_000,
      30_000,
    );
    const maxResponseBytes = parsePositiveInt(
      env.OSM_MAX_RESPONSE_BYTES,
      DEFAULT_OSM_MAX_RESPONSE_BYTES,
      16 * 1024,
      10 * 1024 * 1024,
    );
    const userAgent = (env.OSM_USER_AGENT || DEFAULT_OSM_USER_AGENT).trim();

    const overpassQl = buildOverpassQuery(request, {
      timeoutSeconds: Math.max(5, Math.floor(timeoutMs / 1000) - 2),
      maxSizeBytes: maxResponseBytes,
    });
    const cacheKey = buildCacheKey(endpoint, overpassQl);

    let rawText: string | null = null;
    let cached = false;

    if (!opts.skipCache && env.RATE_LIMIT_KV) {
      try {
        const hit = await env.RATE_LIMIT_KV.get(cacheKey);
        if (hit) {
          rawText = hit;
          cached = true;
        }
      } catch {
        // Non-fatal cache read failure; proceed to Overpass request.
      }
    }

    if (rawText === null) {
      if (activeOsmRequests >= MAX_CONCURRENT_OSM_REQUESTS) {
        throw new DiscoveryJobError(
          'Local OSM Overpass request concurrency limit reached; retrying shortly.',
          {
            kind: 'rate_limited',
            code: 'OSM_CONCURRENCY_LIMIT',
            retryAfterSeconds: 30,
          },
        );
      }

      const fetchFn = opts.fetchImpl ?? fetch;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      activeOsmRequests += 1;
      try {
        const response = await fetchFn(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Accept: 'application/json',
            'User-Agent': userAgent,
          },
          body: `data=${encodeURIComponent(overpassQl)}`,
          signal: controller.signal,
        });

        if (!response.ok) {
          const retryAfter = parseRetryAfterHeader(response.headers.get('retry-after'), now);
          const snippet = await response.text().catch(() => '');
          throw classifyHttpFailure(response.status, retryAfter, snippet);
        }

        rawText = await readBoundedResponseText(response, maxResponseBytes);

        // Cache valid small responses briefly to avoid repeating identical Overpass queries.
        if (env.RATE_LIMIT_KV && rawText.length <= 512 * 1024) {
          await env.RATE_LIMIT_KV.put(cacheKey, rawText, {
            expirationTtl: OSM_CACHE_TTL_SECONDS,
          }).catch(() => {});
        }
      } catch (err) {
        if (err instanceof DiscoveryJobError) throw err;
        if (err instanceof Error && err.name === 'AbortError') {
          throw new DiscoveryJobError(`Overpass request timed out after ${timeoutMs}ms.`, {
            kind: 'transient',
            code: 'OSM_TIMEOUT',
            cause: err,
          });
        }
        throw new DiscoveryJobError(
          err instanceof Error ? err.message : 'Overpass network request failed.',
          {
            kind: 'transient',
            code: 'OSM_NETWORK_ERROR',
            cause: err,
          },
        );
      } finally {
        clearTimeout(timer);
        activeOsmRequests = Math.max(0, activeOsmRequests - 1);
      }
    }

    const parsed = parseOverpassResponseJson(rawText);

    const candidates: NormalizedDiscoveredCandidate[] = [];
    const seenIds = new Set<string>();
    const rejectionReasons: Record<string, number> = {};
    let rejectedCount = 0;
    let truncated = false;

    for (const element of parsed.elements) {
      if (candidates.length >= request.maxResults) {
        truncated = true;
        break;
      }

      const norm = normalizeOsmElement(element, {
        country: request.country,
        stateHint: request.state,
        lgaHint: request.lga,
        categoryFilter: request.category,
      });

      if (!norm.ok) {
        rejectedCount += 1;
        rejectionReasons[norm.reason] = (rejectionReasons[norm.reason] ?? 0) + 1;
        continue;
      }

      if (seenIds.has(norm.candidate.sourceRecordId)) {
        rejectedCount += 1;
        rejectionReasons.duplicate_in_response =
          (rejectionReasons.duplicate_in_response ?? 0) + 1;
        continue;
      }

      seenIds.add(norm.candidate.sourceRecordId);
      candidates.push(norm.candidate);
    }

    return {
      sourceId: this.id,
      endpoint,
      retrievedAt: now,
      sourceDataTimestamp: parsed.sourceDataTimestamp,
      totalRawElements: parsed.elements.length,
      candidates,
      rejectedCount,
      rejectionReasons,
      truncated,
      cached,
    };
  }
}

export const osmSourceAdapter = new OsmDiscoverySourceAdapter();
