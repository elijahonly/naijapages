import { OSM_ATTRIBUTION, OSM_SOURCE_ID, osmSourceAdapter } from './osmSource';
import {
  REGISTRY_FEED_ATTRIBUTION,
  REGISTRY_FEED_SOURCE_ID,
  registryFeedSourceAdapter,
} from './registryFeedSource';
import {
  WEBSITE_ATTRIBUTION,
  WEBSITE_SOURCE_ID,
  websiteStructuredSourceAdapter,
} from './websiteSource';
import type { DiscoverySourceAdapter } from './types';

const adapterRegistry = new Map<string, DiscoverySourceAdapter>([
  [OSM_SOURCE_ID, osmSourceAdapter],
  [WEBSITE_SOURCE_ID, websiteStructuredSourceAdapter],
  [REGISTRY_FEED_SOURCE_ID, registryFeedSourceAdapter],
]);

export function getDiscoverySourceAdapter(sourceId: string): DiscoverySourceAdapter | null {
  return adapterRegistry.get(sourceId) ?? null;
}

export function registerDiscoverySourceAdapter(adapter: DiscoverySourceAdapter): void {
  adapterRegistry.set(adapter.id, adapter);
}

export function listRegisteredDiscoverySourceIds(): string[] {
  return Array.from(adapterRegistry.keys());
}

/**
 * Ensures the canonical OpenStreetMap source record exists in `discovery_sources`
 * with full ODbL licence & attribution metadata.
 *
 * Defaults strictly to `permission_status = 'pending_review'` and `enabled = 0` so
 * administrative & licensing approval is always explicit.
 */
export async function ensureOsmDiscoverySourceRecord(
  db: D1Database,
  opts: {
    baseUrl?: string;
    permissionStatus?: 'pending_review' | 'approved' | 'restricted' | 'rejected' | 'revoked';
    enabled?: boolean;
    rateLimitPerMinute?: number;
    now?: number;
  } = {},
): Promise<void> {
  const now = opts.now ?? Date.now();
  const permissionStatus = opts.permissionStatus ?? 'pending_review';
  const enabled = permissionStatus === 'approved' && Boolean(opts.enabled) ? 1 : 0;
  const baseUrl = opts.baseUrl?.trim() || 'https://www.openstreetmap.org';
  const rateLimit = Math.max(1, Math.trunc(opts.rateLimitPerMinute ?? 6));

  await db
    .prepare(
      `INSERT OR IGNORE INTO discovery_sources (
        id, name, source_type, base_url, description,
        licence_name, licence_url, attribution_text, permitted_usage,
        permission_status, enabled, rate_limit_per_minute,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      OSM_ATTRIBUTION.sourceId,
      OSM_ATTRIBUTION.sourceName,
      OSM_ATTRIBUTION.sourceType,
      baseUrl,
      'Authorised OpenStreetMap Overpass discovery connector for bounded Nigerian business pilot areas.',
      OSM_ATTRIBUTION.licenceName,
      OSM_ATTRIBUTION.licenceUrl,
      OSM_ATTRIBUTION.attributionText,
      OSM_ATTRIBUTION.permittedUsage,
      permissionStatus,
      enabled,
      rateLimit,
      now,
      now,
    )
    .run();
}

/**
 * Registers all built-in legal source connectors in `discovery_sources` with
 * `permission_status = 'pending_review'` and `enabled = 0` by default.
 */
export async function ensureDefaultDiscoverySources(
  db: D1Database,
  now: number = Date.now(),
): Promise<void> {
  await ensureOsmDiscoverySourceRecord(db, { now });

  const additionalSources = [
    {
      attr: WEBSITE_ATTRIBUTION,
      baseUrl: 'https://schema.org/LocalBusiness',
      description:
        'Public official business website structured metadata (schema.org JSON-LD) connector with SSRF guardrails.',
      rateLimit: 20,
    },
    {
      attr: REGISTRY_FEED_ATTRIBUTION,
      baseUrl: 'https://naijapages.ng/data-sources',
      description:
        'Authorised Nigerian public business registry, state portal, or chamber of commerce structured JSON feed connector.',
      rateLimit: 15,
    },
  ];

  for (const src of additionalSources) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO discovery_sources (
          id, name, source_type, base_url, description,
          licence_name, licence_url, attribution_text, permitted_usage,
          permission_status, enabled, rate_limit_per_minute,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', 0, ?, ?, ?)`,
      )
      .bind(
        src.attr.sourceId,
        src.attr.sourceName,
        src.attr.sourceType,
        src.baseUrl,
        src.description,
        src.attr.licenceName,
        src.attr.licenceUrl,
        src.attr.attributionText,
        src.attr.permittedUsage,
        src.rateLimit,
        now,
        now,
      )
      .run();
  }
}
