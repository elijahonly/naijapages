/**
 * Safe Cloudflare D1 Synthetic Record Audit & Cleanup CLI.
 *
 * Defaults to read-only `--dry-run` against local D1 (`--env development --local`).
 * For remote production cleanup:
 *   1. Requires `--remote --env production --confirm-remote`
 *   2. Automatically exports a full D1 SQL backup via `wrangler d1 export` BEFORE deleting anything
 *   3. Executes targeted `DELETE ... WHERE id IN (...)` only for proven synthetic records
 *
 * Usage:
 *   npx tsx scripts/cleanup-synthetic-d1.ts                           # Local D1 dry-run audit
 *   npx tsx scripts/cleanup-synthetic-d1.ts --execute                 # Local D1 backup + targeted cleanup
 *   npx tsx scripts/cleanup-synthetic-d1.ts --remote --env production # Production D1 read-only audit
 *   npx tsx scripts/cleanup-synthetic-d1.ts --remote --env production --execute --confirm-remote
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  isSyntheticBusinessId,
  isSyntheticMarketplaceId,
  isSyntheticOwnerId,
  renderSyntheticCleanupSql,
  type AuditedBusinessRow,
  type AuditedMarketplaceRow,
  type SyntheticAuditReport,
} from './cleanup-synthetic-d1-lib';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

function runD1QueryJson<T>(
  sql: string,
  opts: { remote: boolean; env: string },
): T[] {
  const wranglerArgs = ['wrangler', 'd1', 'execute', 'DB', '--env', opts.env];
  wranglerArgs.push(opts.remote ? '--remote' : '--local');
  wranglerArgs.push('--json', '--command', sql);

  const stdout = execFileSync('npx', wranglerArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(stdout) as Array<{ results?: T[]; success?: boolean }>;
  return parsed[0]?.results ?? [];
}

function auditViaWrangler(opts: { remote: boolean; env: string }): SyntheticAuditReport {
  const bizRows = runD1QueryJson<{
    id: string;
    name: string;
    owner_id: string;
    status: string;
    is_verified: number;
    claimed_from_seed_id: string | null;
    tags_json: string | null;
    owner_exists: number;
  }>(
    `SELECT b.id, b.name, b.owner_id, b.status, b.is_verified, b.claimed_from_seed_id, b.tags_json,
            CASE WHEN u.id IS NOT NULL THEN 1 ELSE 0 END AS owner_exists
     FROM businesses b
     LEFT JOIN user u ON u.id = b.owner_id;`,
    opts,
  );

  const syntheticBusinesses: AuditedBusinessRow[] = [];
  const manualReviewBusinesses: AuditedBusinessRow[] = [];
  const syntheticBizIds = new Set<string>();

  for (const row of bizRows) {
    let reason = '';
    if (isSyntheticBusinessId(row.id)) reason = 'deterministic_synthetic_id';
    else if (isSyntheticOwnerId(row.owner_id)) reason = 'synthetic_system_owner';
    else if (!row.owner_exists) reason = 'orphaned_non_member_owner';
    else if (typeof row.tags_json === 'string' && /"isSample"\s*:\s*true|"issample"/i.test(row.tags_json)) {
      reason = 'issample_marker';
    }

    if (reason) {
      syntheticBizIds.add(row.id);
      syntheticBusinesses.push({
        id: row.id,
        name: row.name,
        ownerId: row.owner_id,
        status: row.status,
        isVerified: row.is_verified,
        claimedFromSeedId: row.claimed_from_seed_id,
        reason,
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

  const mktRows = runD1QueryJson<{
    id: string;
    title: string;
    owner_id: string;
    business_id: string | null;
    status: string;
    owner_exists: number;
  }>(
    `SELECT m.id, m.title, m.owner_id, m.business_id, m.status,
            CASE WHEN u.id IS NOT NULL THEN 1 ELSE 0 END AS owner_exists
     FROM marketplace_items m
     LEFT JOIN user u ON u.id = m.owner_id;`,
    opts,
  );

  const syntheticMarketplaceItems: AuditedMarketplaceRow[] = [];
  const syntheticMktIds = new Set<string>();
  for (const row of mktRows) {
    let reason = '';
    if (isSyntheticMarketplaceId(row.id)) reason = 'deterministic_synthetic_id';
    else if (isSyntheticOwnerId(row.owner_id)) reason = 'synthetic_system_owner';
    else if (!row.owner_exists) reason = 'orphaned_non_member_owner';
    else if (row.business_id && (syntheticBizIds.has(row.business_id) || isSyntheticBusinessId(row.business_id))) {
      reason = 'linked_to_synthetic_business';
    }

    if (reason) {
      syntheticMktIds.add(row.id);
      syntheticMarketplaceItems.push({
        id: row.id,
        title: row.title,
        ownerId: row.owner_id,
        businessId: row.business_id,
        status: row.status,
        reason,
      });
    }
  }

  const revRows = runD1QueryJson<{ id: string; business_id: string; author_id: string }>(
    'SELECT id, business_id, author_id FROM reviews;',
    opts,
  );
  const syntheticReviewIds: string[] = [];
  const syntheticRevIdSet = new Set<string>();
  for (const r of revRows) {
    if (
      syntheticBizIds.has(r.business_id) ||
      isSyntheticBusinessId(r.business_id) ||
      isSyntheticOwnerId(r.author_id)
    ) {
      syntheticReviewIds.push(r.id);
      syntheticRevIdSet.add(r.id);
    }
  }

  const favRows = runD1QueryJson<{ id: string; business_id: string }>(
    'SELECT id, business_id FROM favourites;',
    opts,
  );
  const syntheticFavouriteIds = favRows
    .filter((f) => syntheticBizIds.has(f.business_id) || isSyntheticBusinessId(f.business_id))
    .map((f) => f.id);

  const claimRows = runD1QueryJson<{ id: string; business_id: string }>(
    'SELECT id, business_id FROM claims;',
    opts,
  );
  const syntheticClaimIds = claimRows
    .filter((c) => syntheticBizIds.has(c.business_id) || isSyntheticBusinessId(c.business_id))
    .map((c) => c.id);

  const repRows = runD1QueryJson<{ id: string; target_type: string; target_id: string }>(
    'SELECT id, target_type, target_id FROM reports;',
    opts,
  );
  const syntheticReportIds = repRows
    .filter(
      (rep) =>
        (rep.target_type === 'business' &&
          (syntheticBizIds.has(rep.target_id) || isSyntheticBusinessId(rep.target_id))) ||
        (rep.target_type === 'ad' &&
          (syntheticMktIds.has(rep.target_id) || isSyntheticMarketplaceId(rep.target_id))) ||
        (rep.target_type === 'review' && syntheticRevIdSet.has(rep.target_id)),
    )
    .map((rep) => rep.id);

  const ovrRows = runD1QueryJson<{ id: string; kind: string; listing_id: string }>(
    'SELECT id, kind, listing_id FROM listing_overrides;',
    opts,
  );
  const syntheticOverrideIds = ovrRows
    .filter(
      (ovr) =>
        (ovr.kind === 'business' &&
          (syntheticBizIds.has(ovr.listing_id) || isSyntheticBusinessId(ovr.listing_id))) ||
        (ovr.kind === 'marketplace' &&
          (syntheticMktIds.has(ovr.listing_id) || isSyntheticMarketplaceId(ovr.listing_id))),
    )
    .map((ovr) => ovr.id);

  return {
    syntheticBusinesses,
    manualReviewBusinesses,
    syntheticMarketplaceItems,
    syntheticReviewIds,
    syntheticFavouriteIds,
    syntheticClaimIds,
    syntheticReportIds,
    syntheticOverrideIds,
    counts: {
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
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const remote = args.remote === 'true';
  const env = args.env || (remote ? 'production' : 'development');
  const execute = args.execute === 'true';
  const confirmRemote = args['confirm-remote'] === 'true';

  if (remote && execute && !confirmRemote) {
    throw new Error(
      'Refusing to execute deletions on remote D1 without explicit --confirm-remote flag.',
    );
  }

  console.log(
    `[cleanup-synthetic-d1] Mode=${execute ? 'EXECUTE' : 'DRY-RUN'} Target=${remote ? 'REMOTE' : 'LOCAL'} Env=${env}`,
  );

  const audit = auditViaWrangler({ remote, env });
  console.log('[cleanup-synthetic-d1] Audit summary:', JSON.stringify(audit.counts, null, 2));

  if (audit.manualReviewBusinesses.length > 0) {
    console.log(
      '[cleanup-synthetic-d1] Preserved for manual review (claimed_from_seed_id):',
      JSON.stringify(audit.manualReviewBusinesses, null, 2),
    );
  }

  if (audit.counts.totalDeletions === 0) {
    console.log('[cleanup-synthetic-d1] Database is clean: 0 synthetic or mock records found.');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tmpDir = path.resolve(process.cwd(), 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const sqlPath = path.join(tmpDir, `cleanup-synthetic-${env}-${timestamp}.sql`);
  const sql = renderSyntheticCleanupSql(audit);
  fs.writeFileSync(sqlPath, sql, 'utf8');
  console.log(`[cleanup-synthetic-d1] Targeted cleanup SQL written to ${sqlPath}`);

  if (!execute) {
    console.log('[cleanup-synthetic-d1] Dry run complete. Re-run with --execute to apply.');
    return;
  }

  // Backup BEFORE deleting anything.
  const backupPath = path.join(tmpDir, `d1-backup-${env}-${timestamp}.sql`);
  const exportArgs = [
    'wrangler',
    'd1',
    'export',
    'DB',
    '--env',
    env,
    remote ? '--remote' : '--local',
    '--output',
    backupPath,
  ];
  console.log(`[cleanup-synthetic-d1] Creating pre-deletion backup: ${backupPath}`);
  execFileSync('npx', exportArgs, { cwd: process.cwd(), stdio: 'inherit' });

  const execArgs = ['wrangler', 'd1', 'execute', 'DB', '--env', env];
  if (remote) {
    execArgs.push('--remote', '--yes');
  } else {
    execArgs.push('--local');
  }
  execArgs.push('--file', sqlPath);
  console.log(`[cleanup-synthetic-d1] Applying targeted cleanup SQL...`);
  execFileSync('npx', execArgs, { cwd: process.cwd(), stdio: 'inherit' });

  const postAudit = auditViaWrangler({ remote, env });
  console.log('[cleanup-synthetic-d1] Post-cleanup audit:', JSON.stringify(postAudit.counts, null, 2));
}

try {
  main();
} catch (err) {
  console.error('[cleanup-synthetic-d1] Error:', err instanceof Error ? err.message : err);
  process.exit(1);
}
