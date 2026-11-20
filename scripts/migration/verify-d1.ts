/**
 * D1 record-count and referential/rating data-integrity verifier (Phase 4).
 *
 * Defaults to local Miniflare D1 (`persist: true`). Optionally compares
 * D1 table counts against an exported Firestore snapshot JSON file.
 *
 * Usage:
 *   npx tsx scripts/migration/verify-d1.ts
 *   npx tsx scripts/migration/verify-d1.ts --snapshot tmp/firestore-export.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import {
  findRemainingFirebaseStorageRefs,
  normalizeSnapshot,
  verifyD1Integrity,
  type FirestoreExportSnapshot,
  type NormalizedD1Dataset,
} from './lib';
import type { Bindings } from '../../worker/src/types';

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let expectedDataset: NormalizedD1Dataset | undefined;

  if (args.snapshot) {
    const snapPath = path.resolve(process.cwd(), args.snapshot);
    if (!fs.existsSync(snapPath)) {
      throw new Error(`Snapshot not found: ${snapPath}`);
    }
    const snapshot = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as FirestoreExportSnapshot;
    expectedDataset = normalizeSnapshot(snapshot);
  }

  const proxy = await getPlatformProxy<Bindings>({
    environment: args.env || 'development',
    persist: true,
  });
  try {
    const report = await verifyD1Integrity(proxy.env.DB, expectedDataset);
    const remainingFirebaseMedia = await findRemainingFirebaseStorageRefs(proxy.env.DB);
    console.log('[verify-d1] Table counts:', report.counts);
    console.log('[verify-d1] Unmigrated Firebase Storage refs:', remainingFirebaseMedia);
    if (!report.ok) {
      console.error('[verify-d1] Integrity check FAILED:');
      for (const issue of report.issues) {
        console.error(`  - ${issue}`);
      }
      process.exitCode = 1;
    } else {
      console.log('[verify-d1] All integrity checks passed.');
    }
  } finally {
    await proxy.dispose();
  }
}

main().catch((err) => {
  console.error('[verify-d1] Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
