/**
 * Official Business Website & Structured Data (`schema.org` JSON-LD) Connector.
 *
 * Security & legality guardrails:
 * - Only fetches explicitly provided public HTTP/HTTPS URLs validated against SSRF
 *   rules (`validateSafeExternalFetchUrl` blocks loopback, private RFC1918, and link-local hosts).
 * - Never bypasses logins, paywalls, CAPTCHAs, or anti-bot protections.
 * - Treats all HTML/JSON-LD strictly as untrusted data (no code execution).
 * - Never fabricates missing contact details, addresses, ratings, or CAC numbers.
 */
import {
  normalizeBusinessName,
  normalizeNigerianState,
  validateCoordinates,
} from '../../../lib/discoveryValidation';
import { cleanEmail, cleanText } from '../../../lib/validation';
import type { Bindings } from '../../../types';
import { classifyDiscoveryError, DiscoveryJobError } from '../errors';
import {
  extractStructuredFieldsFromText,
  normalizeNigerianPhone,
  validateSafeExternalFetchUrl,
} from '../normalization';
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

export const WEBSITE_SOURCE_ID = 'official_website_structured';

export const WEBSITE_ATTRIBUTION: SourceAttribution = {
  sourceId: WEBSITE_SOURCE_ID,
  sourceName: 'Official Business Websites (Public JSON-LD / Schema.org)',
  sourceType: 'web_directory',
  licenceName: 'Publicly Published Business Facts',
  licenceUrl: 'https://schema.org/LocalBusiness',
  attributionText: 'Official business website public structured metadata',
  permittedUsage:
    'Factual contact and location corroboration extracted from public schema.org JSON-LD and public contact pages without bypassing access controls.',
};

const SCHEMA_TYPE_TO_CATEGORY: Record<string, string> = {
  restaurant: 'Food',
  foodestablishment: 'Food',
  bakery: 'Food',
  cafeorcoffeeshop: 'Food',
  hotel: 'Hotels',
  lodgingbusiness: 'Hotels',
  hospital: 'Health',
  medicalclinic: 'Health',
  pharmacy: 'Health',
  dentist: 'Health',
  physician: 'Health',
  bankorcreditunion: 'Finance',
  financialservice: 'Finance',
  accountingservice: 'Finance',
  school: 'Education',
  collegeoruniversity: 'Education',
  educationalorganization: 'Education',
  autorepair: 'Auto',
  autodealer: 'Auto',
  beautysalon: 'Beauty',
  hairsalon: 'Beauty',
  dayspa: 'Beauty',
  store: 'Retail',
  grocerystore: 'Retail',
  electronicsstore: 'Tech',
  legalservice: 'Services',
  attorney: 'Services',
  realestateagent: 'Services',
  localbusiness: 'Services',
  organization: 'Services',
};

const MAX_WEBSITE_BYTES = 512 * 1024; // 512 KiB strict bound

export function extractJsonLdLocalBusinesses(html: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw || raw.length > 200_000) continue;
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>)['@graph'])
          ? ((parsed as Record<string, unknown>)['@graph'] as unknown[])
          : [parsed];
      for (const item of items) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const rec = item as Record<string, unknown>;
          const rawType = Array.isArray(rec['@type']) ? rec['@type'][0] : rec['@type'];
          if (typeof rawType === 'string') {
            const key = rawType.toLowerCase().replace(/[^a-z]/g, '');
            if (key in SCHEMA_TYPE_TO_CATEGORY) {
              results.push(rec);
            }
          }
        }
      }
    } catch {
      // Ignore invalid JSON-LD block without crashing extraction.
    }
  }
  return results;
}

export function normalizeWebsiteHtmlToCandidate(
  pageUrl: string,
  html: string,
  opts: { stateHint?: string | null; lgaHint?: string | null } = {},
): NormalizedDiscoveredCandidate | null {
  const jsonLdBlocks = extractJsonLdLocalBusinesses(html);
  const primary = jsonLdBlocks[0] ?? null;

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const rawName =
    (typeof primary?.name === 'string' ? primary.name : null) ??
    (titleMatch ? titleMatch[1].split(/[|\-–—]/)[0] : null);
  const name = rawName ? cleanText(rawName, 140) : '';
  const normalizedName = normalizeBusinessName(name);
  if (!name || !normalizedName) return null;

  const rawType = primary
    ? Array.isArray(primary['@type'])
      ? String(primary['@type'][0] ?? '')
      : String(primary['@type'] ?? '')
    : 'LocalBusiness';
  const typeKey = rawType.toLowerCase().replace(/[^a-z]/g, '');
  const category = SCHEMA_TYPE_TO_CATEGORY[typeKey] ?? 'Services';

  const textFields = extractStructuredFieldsFromText(html);

  const rawPhone =
    (typeof primary?.telephone === 'string' ? primary.telephone : null) ??
    textFields.phones[0] ??
    null;
  const normPhone = normalizeNigerianPhone(rawPhone);
  const secondaryRaw = textFields.phones.find((p) => {
    const n = normalizeNigerianPhone(p);
    return n && normPhone && n.e164 !== normPhone.e164;
  });
  const normSecondary = normalizeNigerianPhone(secondaryRaw);

  const rawEmail =
    (typeof primary?.email === 'string' ? primary.email : null) ??
    textFields.emails[0] ??
    null;
  const email = rawEmail ? cleanEmail(rawEmail) || null : null;

  const addrObj =
    primary?.address && typeof primary.address === 'object' && !Array.isArray(primary.address)
      ? (primary.address as Record<string, unknown>)
      : null;

  const street = addrObj && typeof addrObj.streetAddress === 'string' ? cleanText(addrObj.streetAddress, 180) : null;
  const city = addrObj && typeof addrObj.addressLocality === 'string' ? cleanText(addrObj.addressLocality, 80) : null;
  const rawRegion = addrObj && typeof addrObj.addressRegion === 'string' ? addrObj.addressRegion : opts.stateHint;

  let state: string | null = null;
  if (rawRegion) {
    try {
      state = normalizeNigerianState(rawRegion);
    } catch {
      state = null;
    }
  }
  const lga = opts.lgaHint ? cleanText(opts.lgaHint, 80) || null : null;
  const addressParts = [street, city].filter((p): p is string => Boolean(p));
  const address = addressParts.length > 0 ? cleanText(addressParts.join(', '), 240) : null;

  let latitude: number | null = null;
  let longitude: number | null = null;
  if (primary?.geo && typeof primary.geo === 'object' && !Array.isArray(primary.geo)) {
    const geo = primary.geo as Record<string, unknown>;
    try {
      const coords = validateCoordinates(geo.latitude, geo.longitude, { requireNigeriaBounds: true });
      latitude = coords.latitude;
      longitude = coords.longitude;
    } catch {
      latitude = null;
      longitude = null;
    }
  }

  const openingHours =
    typeof primary?.openingHours === 'string'
      ? cleanText(primary.openingHours, 160)
      : textFields.openingHours;
  const description =
    typeof primary?.description === 'string' ? cleanText(primary.description, 500) : null;

  const parsedUrl = new URL(pageUrl);
  const sourceRecordId = `web:${parsedUrl.hostname.toLowerCase()}${parsedUrl.pathname.replace(/\/+$/, '') || '/'}`;

  const confidenceScore = primary ? 0.62 : 0.42;
  const evidence: CandidateEvidenceInput[] = [
    {
      evidenceType: 'website_check',
      fieldName: 'official_website',
      evidenceValue: pageUrl,
      sourceUrl: pageUrl,
      sourceRecordId,
      sourceTimestamp: null,
      confidence: confidenceScore,
      notes: primary
        ? `Extracted schema.org ${rawType} JSON-LD from public business page.`
        : 'Extracted public contact metadata from business HTML page.',
    },
    {
      evidenceType: 'field_extraction',
      fieldName: 'name',
      evidenceValue: name,
      sourceUrl: pageUrl,
      sourceRecordId,
      sourceTimestamp: null,
      confidence: confidenceScore,
    },
  ];
  if (normPhone) {
    evidence.push({
      evidenceType: 'field_extraction',
      fieldName: 'phone',
      evidenceValue: normPhone.formatted,
      sourceUrl: pageUrl,
      sourceRecordId,
      sourceTimestamp: null,
      confidence: confidenceScore,
    });
  }
  if (address) {
    evidence.push({
      evidenceType: 'field_extraction',
      fieldName: 'address',
      evidenceValue: address,
      sourceUrl: pageUrl,
      sourceRecordId,
      sourceTimestamp: null,
      confidence: confidenceScore,
    });
  }

  return {
    sourceRecordId,
    sourceRecordType: 'official_website',
    sourceUrl: pageUrl,
    name,
    normalizedName,
    category,
    subcategory: `schema:${typeKey || 'localbusiness'}`,
    country: 'Nigeria',
    state,
    lga,
    city,
    address,
    phone: normPhone?.formatted ?? null,
    secondaryPhone: normSecondary?.formatted ?? null,
    email,
    website: pageUrl,
    latitude,
    longitude,
    openingHours,
    description,
    brand: null,
    operator: null,
    rawSourceData: {
      pageUrl,
      schemaType: rawType,
      hasJsonLd: Boolean(primary),
      detectedSignals: textFields.detectedSignals,
    },
    normalizedData: {
      canonicalUrl: pageUrl,
      closureNoticeDetected: textFields.closureNoticeDetected,
      relocationNoticeDetected: textFields.relocationNoticeDetected,
    },
    identityHash: `web_${normalizedName.replace(/\s+/g, '_').slice(0, 40)}_${(state ?? 'ng').toLowerCase()}`,
    confidenceScore,
    sourceTimestamp: null,
    evidence,
  };
}

export class WebsiteStructuredSourceAdapter implements DiscoverySourceAdapter {
  readonly id = WEBSITE_SOURCE_ID;
  readonly attribution = WEBSITE_ATTRIBUTION;

  validateQuery(raw: Partial<DiscoveryQueryRequest>): DiscoveryQueryRequest {
    const endpointUrl = validateSafeExternalFetchUrl(raw.endpointUrl ?? '');
    return {
      country: 'Nigeria',
      state: raw.state ?? null,
      lga: raw.lga ?? null,
      category: raw.category ?? null,
      bbox: raw.bbox ?? { south: 6.4, west: 3.3, north: 6.5, east: 3.5 },
      maxResults: Math.min(20, Math.max(1, Math.trunc(raw.maxResults ?? 1))),
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
      message: 'Official website structured-data connector ready (per-URL SSRF-guarded fetch).',
    };
  }

  async discover(
    rawRequest: Partial<DiscoveryQueryRequest>,
    env: Partial<Bindings>,
    opts: DiscoverySourceAdapterOptions = {},
  ): Promise<SourceDiscoveryBatchResult> {
    const req = this.validateQuery(rawRequest);
    const targetUrl = req.endpointUrl!;
    const now = opts.now ?? Date.now();
    const fetchFn = opts.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);

    try {
      const res = await fetchFn(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent': (env.OSM_USER_AGENT || 'NaijaPagesDiscovery/1.0 (+https://naijapages.ng)').trim(),
          Accept: 'text/html, application/xhtml+xml',
        },
        redirect: 'follow',
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new DiscoveryJobError(`Website returned HTTP ${res.status}.`, {
          kind: res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'transient' : 'permanent',
          code: `WEBSITE_HTTP_${res.status}`,
        });
      }

      const rawHtml = (await res.text()).slice(0, MAX_WEBSITE_BYTES);
      const candidate = normalizeWebsiteHtmlToCandidate(targetUrl, rawHtml, {
        stateHint: req.state,
        lgaHint: req.lga,
      });

      return {
        sourceId: this.id,
        endpoint: targetUrl,
        retrievedAt: now,
        sourceDataTimestamp: null,
        totalRawElements: 1,
        candidates: candidate ? [candidate] : [],
        rejectedCount: candidate ? 0 : 1,
        rejectionReasons: candidate ? {} : { missing_structured_business_identity: 1 },
        truncated: false,
        cached: false,
      };
    } catch (err) {
      if (err instanceof DiscoveryJobError) throw err;
      throw new DiscoveryJobError(
        err instanceof Error ? err.message : 'Website fetch failed.',
        {
          kind: 'transient',
          code: 'WEBSITE_FETCH_ERROR',
          cause: err,
        },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export const websiteStructuredSourceAdapter = new WebsiteStructuredSourceAdapter();
