/**
 * Pure audit, SQL generation, and targeted deletion helpers for permanently removing
 * synthetic, mock, or initially-generated businesses and marketplace items from
 * Cloudflare D1 while strictly preserving all genuine user-contributed data.
 *
 * Schema note (worker/migrations/0001..0003):
 * - D1 `businesses` and `marketplace_items` tables do not have an `isSample` / `is_sample`
 *   column. Synthetic origin is determined strictly via deterministic ID patterns,
 *   synthetic system owner IDs, orphaned non-member rows, or explicit `"isSample"` tag markers.
 * - Never executes an unrestricted `DELETE FROM businesses` or `DELETE FROM marketplace_items`.
 */

export const SYNTHETIC_MARKETPLACE_DEMO_IDS = [
  'mkt-1',
  'mkt-2',
  'mkt-3',
  'mkt-4',
  'mkt-5',
  'mkt-6',
  'mkt-7',
  'mkt-8',
  'mkt-9',
  'mkt-10',
  'mkt-11',
  'mkt-12',
] as const;

export const SYNTHETIC_OWNER_IDS = [
  'migrated_system',
  'system',
  'seed',
  'sample',
  'mock',
  'demo',
  'placeholder',
] as const;

const SYNTHETIC_ID_REGEX =
  /^(?:sample-|gen-|seed-|mock-|dummy-|placeholder-|demo-)|-gen-\d+$/i;

const SYNTHETIC_DEMO_AD_SET = new Set<string>(SYNTHETIC_MARKETPLACE_DEMO_IDS);
const SYNTHETIC_OWNER_SET = new Set<string>(SYNTHETIC_OWNER_IDS);

export function isSyntheticBusinessId(id: string): boolean {
  const clean = id.trim();
  if (!clean) return false;
  return SYNTHETIC_ID_REGEX.test(clean);
}

export function isSyntheticMarketplaceId(id: string): boolean {
  const clean = id.trim().toLowerCase();
  if (!clean) return false;
  return SYNTHETIC_DEMO_AD_SET.has(clean) || SYNTHETIC_ID_REGEX.test(clean);
}

export function isSyntheticOwnerId(ownerId: string | null | undefined): boolean {
  if (!ownerId) return true;
  return SYNTHETIC_OWNER_SET.has(ownerId.trim().toLowerCase());
}

export interface AuditedBusinessRow {
  id: string;
  name: string;
  ownerId: string;
  status: string;
  isVerified: number;
  claimedFromSeedId: string | null;
  reason: string;
}

export interface AuditedMarketplaceRow {
  id: string;
  title: string;
  ownerId: string;
  businessId: string | null;
  status: string;
  reason: string;
}

export interface SyntheticAuditReport {
  syntheticBusinesses: AuditedBusinessRow[];
  manualReviewBusinesses: AuditedBusinessRow[];
  syntheticMarketplaceItems: AuditedMarketplaceRow[];
  syntheticReviewIds: string[];
  syntheticFavouriteIds: string[];
  syntheticClaimIds: string[];
  syntheticReportIds: string[];
  syntheticOverrideIds: string[];
  counts: {
    businesses: number;
    manualReviewBusinesses: number;
    marketplaceItems: number;
    reviews: number;
    favourites: number;
    claims: number;
    reports: number;
    listingOverrides: number;
    totalDeletions: number;
  };
}

export interface CleanupExecutionResult {
  before: SyntheticAuditReport['counts'];
  deleted: {
    businesses: number;
    marketplaceItems: number;
    reviews: number;
    favourites: number;
    claims: number;
    reports: number;
    listingOverrides: number;
    total: number;
  };
  after: SyntheticAuditReport['counts'];
}

interface RawBusinessRow {
  id: string;
  name: string;
  owner_id: string;
  status: string;
  is_verified: number;
  claimed_from_seed_id: string | null;
  tags_json: string | null;
  owner_exists: number;
}

interface RawMarketplaceRow {
  id: string;
  title: string;
  owner_id: string;
  business_id: string | null;
  status: string;
  owner_exists: number;
}

interface RawReviewRow {
  id: string;
  business_id: string;
  author_id: string;
}

interface RawFavouriteRow {
  id: string;
  business_id: string;
}

interface RawClaimRow {
  id: string;
  business_id: string;
}

interface RawReportRow {
  id: string;
  target_type: string;
  target_id: string;
}

interface RawOverrideRow {
  id: string;
  kind: string;
  listing_id: string;
}

function classifyBusiness(row: RawBusinessRow): { synthetic: boolean; reason: string } {
  if (isSyntheticBusinessId(row.id)) {
    return { synthetic: true, reason: 'deterministic_synthetic_id' };
  }
  if (isSyntheticOwnerId(row.owner_id)) {
    return { synthetic: true, reason: 'synthetic_system_owner' };
  }
  if (!row.owner_exists) {
    return { synthetic: true, reason: 'orphaned_non_member_owner' };
  }
  if (typeof row.tags_json === 'string' && /"isSample"\s*:\s*true|"issample"/i.test(row.tags_json)) {
    return { synthetic: true, reason: 'issample_marker' };
  }
  return { synthetic: false, reason: '' };
}

function classifyMarketplaceItem(
  row: RawMarketplaceRow,
  syntheticBusinessIds: Set<string>,
): { synthetic: boolean; reason: string } {
  if (isSyntheticMarketplaceId(row.id)) {
    return { synthetic: true, reason: 'deterministic_synthetic_id' };
  }
  if (isSyntheticOwnerId(row.owner_id)) {
    return { synthetic: true, reason: 'synthetic_system_owner' };
  }
  if (!row.owner_exists) {
    return { synthetic: true, reason: 'orphaned_non_member_owner' };
  }
  if (row.business_id && (syntheticBusinessIds.has(row.business_id) || isSyntheticBusinessId(row.business_id))) {
    return { synthetic: true, reason: 'linked_to_synthetic_business' };
  }
  return { synthetic: false, reason: '' };
}

/**
 * Read-only audit of Cloudflare D1 for synthetic/mock records and their dependent references.
 */
export async function auditSyntheticD1(db: D1Database): Promise<SyntheticAuditReport> {
  const bizRes = await db
    .prepare(
      `SELECT b.id, b.name, b.owner_id, b.status, b.is_verified, b.claimed_from_seed_id, b.tags_json,
              CASE WHEN u.id IS NOT NULL THEN 1 ELSE 0 END AS owner_exists
       FROM businesses b
       LEFT JOIN user u ON u.id = b.owner_id`,
    )
    .all<RawBusinessRow>();

  const syntheticBusinesses: AuditedBusinessRow[] = [];
  const manualReviewBusinesses: AuditedBusinessRow[] = [];
  const syntheticBizIds = new Set<string>();

  for (const row of bizRes.results ?? []) {
    const verdict = classifyBusiness(row);
    if (verdict.synthetic) {
      syntheticBizIds.add(row.id);
      syntheticBusinesses.push({
        id: row.id,
        name: row.name,
        ownerId: row.owner_id,
        status: row.status,
        isVerified: row.is_verified,
        claimedFromSeedId: row.claimed_from_seed_id,
        reason: verdict.reason,
      });
    } else if (row.claimed_from_seed_id && row.claimed_from_seed_id.trim()) {
      manualReviewBusinesses.push({
        id: row.id,
        name: row.name,
        ownerId: row.owner_id,
        status: row.status,
        isVerified: row.is_verified,
        claimedFromSeedId: row.claimed_from_seed_id,
        reason: 'claimed_from_legacy_seed_id_preserve_for_review',
      });
    }
  }

  const mktRes = await db
    .prepare(
      `SELECT m.id, m.title, m.owner_id, m.business_id, m.status,
              CASE WHEN u.id IS NOT NULL THEN 1 ELSE 0 END AS owner_exists
       FROM marketplace_items m
       LEFT JOIN user u ON u.id = m.owner_id`,
    )
    .all<RawMarketplaceRow>();

  const syntheticMarketplaceItems: AuditedMarketplaceRow[] = [];
  const syntheticMktIds = new Set<string>();

  for (const row of mktRes.results ?? []) {
    const verdict = classifyMarketplaceItem(row, syntheticBizIds);
    if (verdict.synthetic) {
      syntheticMktIds.add(row.id);
      syntheticMarketplaceItems.push({
        id: row.id,
        title: row.title,
        ownerId: row.owner_id,
        businessId: row.business_id,
        status: row.status,
        reason: verdict.reason,
      });
    }
  }

  const revRes = await db
    .prepare('SELECT id, business_id, author_id FROM reviews')
    .all<RawReviewRow>();
  const syntheticReviewIds: string[] = [];
  const syntheticRevIdSet = new Set<string>();
  for (const r of revRes.results ?? []) {
    if (
      syntheticBizIds.has(r.business_id) ||
      isSyntheticBusinessId(r.business_id) ||
      isSyntheticOwnerId(r.author_id)
    ) {
      syntheticReviewIds.push(r.id);
      syntheticRevIdSet.add(r.id);
    }
  }

  const favRes = await db
    .prepare('SELECT id, business_id FROM favourites')
    .all<RawFavouriteRow>();
  const syntheticFavouriteIds: string[] = [];
  for (const f of favRes.results ?? []) {
    if (syntheticBizIds.has(f.business_id) || isSyntheticBusinessId(f.business_id)) {
      syntheticFavouriteIds.push(f.id);
    }
  }

  const claimRes = await db
    .prepare('SELECT id, business_id FROM claims')
    .all<RawClaimRow>();
  const syntheticClaimIds: string[] = [];
  for (const cl of claimRes.results ?? []) {
    if (syntheticBizIds.has(cl.business_id) || isSyntheticBusinessId(cl.business_id)) {
      syntheticClaimIds.push(cl.id);
    }
  }

  const repRes = await db
    .prepare('SELECT id, target_type, target_id FROM reports')
    .all<RawReportRow>();
  const syntheticReportIds: string[] = [];
  for (const rep of repRes.results ?? []) {
    const isSyntheticTarget =
      (rep.target_type === 'business' &&
        (syntheticBizIds.has(rep.target_id) || isSyntheticBusinessId(rep.target_id))) ||
      (rep.target_type === 'ad' &&
        (syntheticMktIds.has(rep.target_id) || isSyntheticMarketplaceId(rep.target_id))) ||
      (rep.target_type === 'review' && syntheticRevIdSet.has(rep.target_id));
    if (isSyntheticTarget) {
      syntheticReportIds.push(rep.id);
    }
  }

  const ovrRes = await db
    .prepare('SELECT id, kind, listing_id FROM listing_overrides')
    .all<RawOverrideRow>();
  const syntheticOverrideIds: string[] = [];
  for (const ovr of ovrRes.results ?? []) {
    const isSyntheticOverride =
      (ovr.kind === 'business' &&
        (syntheticBizIds.has(ovr.listing_id) || isSyntheticBusinessId(ovr.listing_id))) ||
      (ovr.kind === 'marketplace' &&
        (syntheticMktIds.has(ovr.listing_id) || isSyntheticMarketplaceId(ovr.listing_id)));
    if (isSyntheticOverride) {
      syntheticOverrideIds.push(ovr.id);
    }
  }

  const counts = {
    businesses: syntheticBusinesses.length,
    manualReviewBusinesses: manualReviewBusinesses.length,
    marketplaceItems: syntheticMarketplaceItems.length,
    reviews: syntheticReviewIds.length,
    favourites: syntheticFavouriteIds.length,
    claims: syntheticClaimIds.length,
    reports: syntheticReportIds.length,
    listingOverrides: syntheticOverrideIds.length,
    totalDeletions:
      syntheticBusinesses.length +
      syntheticMarketplaceItems.length +
      syntheticReviewIds.length +
      syntheticFavouriteIds.length +
      syntheticClaimIds.length +
      syntheticReportIds.length +
      syntheticOverrideIds.length,
  };

  return {
    syntheticBusinesses,
    manualReviewBusinesses,
    syntheticMarketplaceItems,
    syntheticReviewIds,
    syntheticFavouriteIds,
    syntheticClaimIds,
    syntheticReportIds,
    syntheticOverrideIds,
    counts,
  };
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Generates explicit, targeted SQL DELETE statements for ONLY the exact audited synthetic IDs.
 * Never generates unrestricted table deletes.
 */
export function renderSyntheticCleanupSql(audit: SyntheticAuditReport): string {
  const lines: string[] = [
    '-- Targeted NaijaPages Cloudflare D1 Synthetic Record Cleanup',
    '-- Deletes ONLY explicitly identified synthetic/mock IDs and dependent references.',
    'PRAGMA foreign_keys = ON;',
  ];

  const emitDeletes = (table: string, ids: string[]) => {
    for (const batch of chunkArray(ids, 50)) {
      const list = batch.map(sqlString).join(', ');
      lines.push(`DELETE FROM ${table} WHERE id IN (${list});`);
    }
  };

  // Delete dependent rows first, then parent synthetic marketplace_items and businesses.
  emitDeletes('reports', audit.syntheticReportIds);
  emitDeletes('reviews', audit.syntheticReviewIds);
  emitDeletes('favourites', audit.syntheticFavouriteIds);
  emitDeletes('claims', audit.syntheticClaimIds);
  emitDeletes('listing_overrides', audit.syntheticOverrideIds);
  emitDeletes(
    'marketplace_items',
    audit.syntheticMarketplaceItems.map((m) => m.id),
  );
  emitDeletes(
    'businesses',
    audit.syntheticBusinesses.map((b) => b.id),
  );

  return `${lines.join('\n')}\n`;
}

/**
 * Executes parameterized targeted deletions directly against a D1Database binding.
 */
export async function executeSyntheticD1Cleanup(db: D1Database): Promise<CleanupExecutionResult> {
  const beforeAudit = await auditSyntheticD1(db);

  const deleteByIds = async (table: string, ids: string[]): Promise<number> => {
    let removed = 0;
    for (const batch of chunkArray(ids, 50)) {
      const placeholders = batch.map(() => '?').join(', ');
      const res = await db
        .prepare(`DELETE FROM ${table} WHERE id IN (${placeholders})`)
        .bind(...batch)
        .run();
      removed += Number(res.meta?.changes ?? batch.length);
    }
    return removed;
  };

  const reports = await deleteByIds('reports', beforeAudit.syntheticReportIds);
  const reviews = await deleteByIds('reviews', beforeAudit.syntheticReviewIds);
  const favourites = await deleteByIds('favourites', beforeAudit.syntheticFavouriteIds);
  const claims = await deleteByIds('claims', beforeAudit.syntheticClaimIds);
  const listingOverrides = await deleteByIds('listing_overrides', beforeAudit.syntheticOverrideIds);
  const marketplaceItems = await deleteByIds(
    'marketplace_items',
    beforeAudit.syntheticMarketplaceItems.map((m) => m.id),
  );
  const businesses = await deleteByIds(
    'businesses',
    beforeAudit.syntheticBusinesses.map((b) => b.id),
  );

  const afterAudit = await auditSyntheticD1(db);

  return {
    before: beforeAudit.counts,
    deleted: {
      businesses,
      marketplaceItems,
      reviews,
      favourites,
      claims,
      reports,
      listingOverrides,
      total:
        businesses +
        marketplaceItems +
        reviews +
        favourites +
        claims +
        reports +
        listingOverrides,
    },
    after: afterAudit.counts,
  };
}
