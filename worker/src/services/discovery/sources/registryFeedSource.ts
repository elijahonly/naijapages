/**
 * Authorised Open Registry / Chamber of Commerce / Partner JSON Feed Connector.
 *
 * Designed for legally approved Nigerian public registries, state business portals,
 * trade associations, and chambers of commerce that publish structured JSON feeds
 * with explicit redistribution permission.
 *
 * Strict guardrails:
 * - Never scrapes paywalled or restricted portals.
 * - Requires an explicitly approved `discovery_sources` record and SSRF-safe HTTPS URL.
 * - Preserves registration numbers ONLY when explicitly present in the authoritative feed.
 */
import {
  normalizeBusinessName,
  normalizeNigerianState,
  validateCoordinates,
  validateDiscoveryUrl,
} from '../../../lib/discoveryValidation';
import { cleanEmail, cleanText } from '../../../lib/validation';
import type { Bindings } from '../../../types';
import { classifyDiscoveryError, DiscoveryJobError } from '../errors';
import { normalizeNigerianPhone, validateSafeExternalFetchUrl } from '../normalization';
import type {
  CandidateEvidenceInput,
  DiscoveryQueryRequest,
  DiscoverySourceAdapter,
  DiscoverySourceAdapterOptions,
  NormalizedDiscoveredCandidate,
  SourceAttribution,
  SourceDiscoveryBatchResult,
  SourceHealthCheckResult,
} from './types';

export const REGISTRY_FEED_SOURCE_ID = 'authorised_open_registry';

export const REGISTRY_FEED_ATTRIBUTION: SourceAttribution = {
  sourceId: REGISTRY_FEED_SOURCE_ID,
  sourceName: 'Authorised Nigerian Business Registry / Chamber Open Feed',
  sourceType: 'public_registry',
  licenceName: 'Authorised Open Government / Partner Data Licence',
  licenceUrl: 'https://naijapages.ng/data-sources',
  attributionText: 'Authorised Nigerian public business registry / chamber feed',
  permittedUsage:
    'Permitted only for explicitly approved government registries, chambers of commerce, or licensed partner feeds whose licence allows directory republication.',
};

export interface RegistryFeedRecord {
  id?: string | number;
  registration_number?: string;
  name?: string;
  category?: string;
  state?: string;
  lga?: string;
  city?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  latitude?: number;
  longitude?: number;
  status?: string;
  source_url?: string;
  updated_at?: string;
}

export function normalizeRegistryFeedRecord(
  record: RegistryFeedRecord,
  feedUrl: string,
): { ok: true; candidate: NormalizedDiscoveredCandidate } | { ok: false; reason: string } {
  if (!record || typeof record !== 'object') {
    return { ok: false, reason: 'malformed_record' };
  }

  const statusLower = typeof record.status === 'string' ? record.status.trim().toLowerCase() : 'active';
  if (statusLower === 'dissolved' || statusLower === 'closed' || statusLower === 'struck_off') {
    return { ok: false, reason: 'inactive_registry_record' };
  }

  const name = cleanText(record.name ?? '', 140);
  const normalizedName = normalizeBusinessName(name);
  if (!name || !normalizedName) {
    return { ok: false, reason: 'missing_name' };
  }

  const rawId =
    record.id !== undefined && record.id !== null
      ? String(record.id).trim()
      : record.registration_number?.trim() || '';
  if (!rawId) {
    return { ok: false, reason: 'missing_record_id' };
  }

  let state: string | null = null;
  if (record.state) {
    try {
      state = normalizeNigerianState(record.state);
    } catch {
      state = null;
    }
  }
  const lga = cleanText(record.lga ?? '', 80) || null;
  const city = cleanText(record.city ?? '', 80) || null;
  const address = cleanText(record.address ?? '', 240) || null;
  const category = cleanText(record.category ?? '', 60) || 'Services';
  const normPhone = normalizeNigerianPhone(record.phone);
  const email = record.email ? cleanEmail(record.email) || null : null;

  let website: string | null = null;
  if (record.website) {
    try {
      website = validateDiscoveryUrl(record.website, 'website', {
        required: false,
        httpsOnly: false,
      });
    } catch {
      website = null;
    }
  }

  let latitude: number | null = null;
  let longitude: number | null = null;
  if (record.latitude !== undefined && record.longitude !== undefined) {
    try {
      const coords = validateCoordinates(record.latitude, record.longitude, {
        requireNigeriaBounds: true,
      });
      latitude = coords.latitude;
      longitude = coords.longitude;
    } catch {
      latitude = null;
      longitude = null;
    }
  }

  const regNo = cleanText(record.registration_number ?? '', 40) || null;
  const sourceRecordId = `reg:${rawId}`;
  const sourceUrl =
    typeof record.source_url === 'string' && /^https?:\/\//i.test(record.source_url)
      ? record.source_url
      : feedUrl;
  const sourceTs = record.updated_at ? Date.parse(record.updated_at) : NaN;
  const sourceTimestamp = Number.isFinite(sourceTs) ? Math.trunc(sourceTs) : null;

  const confidenceScore = regNo ? 0.78 : 0.68;
  const evidence: CandidateEvidenceInput[] = [
    {
      evidenceType: 'registry_match',
      fieldName: 'registry_record',
      evidenceValue: JSON.stringify({
        sourceRecordId,
        registrationNumber: regNo,
        status: statusLower,
      }),
      sourceUrl,
      sourceRecordId,
      sourceTimestamp,
      confidence: confidenceScore,
      notes: 'Authorised registry/chamber feed record.',
    },
    {
      evidenceType: 'field_extraction',
      fieldName: 'name',
      evidenceValue: name,
      sourceUrl,
      sourceRecordId,
      sourceTimestamp,
      confidence: confidenceScore,
    },
  ];
  if (normPhone) {
    evidence.push({
      evidenceType: 'field_extraction',
      fieldName: 'phone',
      evidenceValue: normPhone.formatted,
      sourceUrl,
      sourceRecordId,
      sourceTimestamp,
      confidence: confidenceScore,
    });
  }
  if (address) {
    evidence.push({
      evidenceType: 'field_extraction',
      fieldName: 'address',
      evidenceValue: address,
      sourceUrl,
      sourceRecordId,
      sourceTimestamp,
      confidence: confidenceScore,
    });
  }

  return {
    ok: true,
    candidate: {
      sourceRecordId,
      sourceRecordType: 'registry_feed',
      sourceUrl,
      name,
      normalizedName,
      category,
      subcategory: null,
      country: 'Nigeria',
      state,
      lga,
      city,
      address,
      phone: normPhone?.formatted ?? null,
      secondaryPhone: null,
      email,
      website,
      latitude,
      longitude,
      openingHours: null,
      description: null,
      brand: null,
      operator: null,
      rawSourceData: { ...record, registrationNumber: regNo },
      normalizedData: { registrationNumber: regNo, registryStatus: statusLower },
      identityHash: `reg_${normalizedName.replace(/\s+/g, '_').slice(0, 40)}_${(state ?? 'ng').toLowerCase()}`,
      confidenceScore,
      sourceTimestamp,
      evidence,
    },
  };
}

export class RegistryFeedSourceAdapter implements DiscoverySourceAdapter {
  readonly id = REGISTRY_FEED_SOURCE_ID;
  readonly attribution = REGISTRY_FEED_ATTRIBUTION;

  validateQuery(raw: Partial<DiscoveryQueryRequest>): DiscoveryQueryRequest {
    const endpointUrl = validateSafeExternalFetchUrl(raw.endpointUrl ?? '');
    return {
      country: 'Nigeria',
      state: raw.state ?? null,
      lga: raw.lga ?? null,
      category: raw.category ?? null,
      bbox: raw.bbox ?? { south: 6.4, west: 3.3, north: 6.5, east: 3.5 },
      maxResults: Math.min(500, Math.max(1, Math.trunc(raw.maxResults ?? 100))),
      endpointUrl,
    };
  }

  classifyError(err: unknown) {
    return classifyDiscoveryError(err);
  }

  async healthCheck(
    _env: Partial<Bindings>,
    _opts: DiscoverySourceAdapterOptions = {},
  ): Promise<SourceHealthCheckResult> {
    return {
      ok: true,
      sourceId: this.id,
      endpoint: null,
      latencyMs: 0,
      message: 'Authorised open registry JSON feed connector ready (requires approved endpoint URL per job).',
    };
  }

  async discover(
    rawRequest: Partial<DiscoveryQueryRequest>,
    env: Partial<Bindings>,
    opts: DiscoverySourceAdapterOptions = {},
  ): Promise<SourceDiscoveryBatchResult> {
    const req = this.validateQuery(rawRequest);
    const feedUrl = req.endpointUrl!;
    const now = opts.now ?? Date.now();
    const fetchFn = opts.fetchImpl ?? fetch;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetchFn(feedUrl, {
        method: 'GET',
        headers: {
          'User-Agent': (env.OSM_USER_AGENT || 'NaijaPagesDiscovery/1.0 (+https://naijapages.ng)').trim(),
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new DiscoveryJobError(`Registry feed returned HTTP ${res.status}.`, {
          kind: res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'transient' : 'permanent',
          code: `REGISTRY_HTTP_${res.status}`,
        });
      }

      const payload = (await res.json()) as { items?: RegistryFeedRecord[]; records?: RegistryFeedRecord[] } | RegistryFeedRecord[];
      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload.items)
          ? payload.items
          : Array.isArray(payload.records)
            ? payload.records
            : null;

      if (!rows) {
        throw new DiscoveryJobError('Registry feed payload must be a JSON array or contain an `items`/`records` array.', {
          kind: 'permanent',
          code: 'REGISTRY_MALFORMED_JSON',
        });
      }

      const candidates: NormalizedDiscoveredCandidate[] = [];
      const rejectionReasons: Record<string, number> = {};
      let rejectedCount = 0;
      let truncated = false;

      for (const row of rows) {
        if (candidates.length >= req.maxResults) {
          truncated = true;
          break;
        }
        const norm = normalizeRegistryFeedRecord(row, feedUrl);
        if (!norm.ok) {
          rejectedCount += 1;
          rejectionReasons[norm.reason] = (rejectionReasons[norm.reason] ?? 0) + 1;
          continue;
        }
        candidates.push(norm.candidate);
      }

      return {
        sourceId: this.id,
        endpoint: feedUrl,
        retrievedAt: now,
        sourceDataTimestamp: now,
        totalRawElements: rows.length,
        candidates,
        rejectedCount,
        rejectionReasons,
        truncated,
        cached: false,
      };
    } catch (err) {
      if (err instanceof DiscoveryJobError) throw err;
      throw new DiscoveryJobError(
        err instanceof Error ? err.message : 'Registry feed fetch failed.',
        {
          kind: 'transient',
          code: 'REGISTRY_FETCH_ERROR',
          cause: err,
        },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export const registryFeedSourceAdapter = new RegistryFeedSourceAdapter();
