import { OSM_ATTRIBUTION, OSM_SOURCE_ID, osmSourceAdapter } from './osmSource';
import type { DiscoverySourceAdapter } from './types';

const adapterRegistry = new Map<string, DiscoverySourceAdapter>([
  [OSM_SOURCE_ID, osmSourceAdapter],
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
