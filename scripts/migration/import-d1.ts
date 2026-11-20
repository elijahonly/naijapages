/**
 * Idempotent Firestore snapshot -> Cloudflare D1 importer (Phase 4).
 *
 * Defaults to local Miniflare D1 (`--local`) and executes only non-destructive
 * UPSERT statements (`INSERT ... ON CONFLICT DO UPDATE`).
 *
 * Safety guard: refuses to run against remote D1 unless BOTH
 * `--remote --env <development|production> --confirm-remote` are explicitly passed.
 *
 * Usage:
 *   npx tsx scripts/migration/import-d1.ts --input tmp/firestore-export.json
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeSnapshot,
  renderSqlFile,
  type FirestoreExportSnapshot,
} from './lib';

function parseArgs(argv: string[]) {
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(process.cwd(), args.input || 'tmp/firestore-export.json');
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Snapshot file not found: ${inputPath}`);
  }

  const isRemote = args.remote === 'true';
  const envName = args.env;
  const confirmRemote = args['confirm-remote'] === 'true';

  if (isRemote) {
    if (!envName || !['development', 'production'].includes(envName)) {
      throw new Error('When using --remote, specify --env development or --env production.');
    }
    if (!confirmRemote) {
      throw new Error(
        'Refusing to touch remote D1 without explicit --confirm-remote approval flag.',
      );
    }
  }

  const snapshot = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as FirestoreExportSnapshot;
  const dataset = normalizeSnapshot(snapshot);
  const sql = renderSqlFile(dataset);

  const sqlOutPath = path.resolve(process.cwd(), args['sql-out'] || 'tmp/d1-import.sql');
  fs.mkdirSync(path.dirname(sqlOutPath), { recursive: true });
  fs.writeFileSync(sqlOutPath, sql, 'utf8');

  console.log('[import-d1] Normalized counts:', {
    users: dataset.users.length,
    admin_records: dataset.adminRecords.length,
    user_bans: dataset.userBans.length,
    businesses: dataset.businesses.length,
    marketplace_items: dataset.marketplaceItems.length,
    reviews: dataset.reviews.length,
    favourites: dataset.favourites.length,
    claims: dataset.claims.length,
    reports: dataset.reports.length,
    listing_overrides: dataset.listingOverrides.length,
    contact_messages: dataset.contactMessages.length,
    newsletter_subscribers: dataset.newsletterSubscribers.length,
    site_settings: dataset.siteSettings.length,
    audit_log: dataset.auditLog.length,
    media_objects: dataset.mediaObjects?.length ?? 0,
  });

  if (args['dry-run'] === 'true') {
    console.log(`[import-d1] Dry run complete. SQL written to ${sqlOutPath}`);
    return;
  }

  const wranglerArgs = ['wrangler', 'd1', 'execute', 'DB'];
  if (isRemote) {
    wranglerArgs.push('--remote', '--env', envName!, '--yes');
  } else {
    wranglerArgs.push('--env', 'development', '--local');
  }
  wranglerArgs.push('--file', sqlOutPath);

  console.log(`[import-d1] Executing: npx ${wranglerArgs.join(' ')}`);
  execFileSync('npx', wranglerArgs, { stdio: 'inherit' });
  console.log('[import-d1] Import finished successfully.');
}

try {
  main();
} catch (err) {
  console.error('[import-d1] Error:', err instanceof Error ? err.message : err);
  process.exit(1);
}
