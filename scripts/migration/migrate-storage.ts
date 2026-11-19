/**
 * Non-destructive Firebase Storage -> Cloudflare R2 media migrator (Phase 5).
 *
 * Reads a Firestore export snapshot JSON file (or scans existing D1 rows when
 * `--from-d1` is passed), downloads accessible Firebase Storage objects, verifies
 * binary magic bytes & size limits, uploads objects into R2 (`MEDIA_BUCKET`),
 * records ownership in `media_objects`, and updates D1 image references to use
 * R2 delivery URLs.
 *
 * Never modifies or deletes objects in Firebase Storage.
 * Defaults to local Miniflare (`--local`). Refuses remote execution unless BOTH
 * `--remote --env <development|production> --confirm-remote` are explicitly passed.
 *
 * Usage:
 *   npx tsx scripts/migration/migrate-storage.ts --input tmp/firestore-export.json
 *   npx tsx scripts/migration/migrate-storage.ts --from-d1
 */
import fs from 'node:fs';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import {
  buildMediaDeliveryUrl,
  buildUniqueMediaKey,
  defaultVisibilityForPurpose,
  detectMagicMimeType,
  allowedMimeTypesForPurpose,
  MAX_SIZE_BYTES_BY_PURPOSE,
  sha256Hex,
  type MediaEntityType,
  type MediaPurpose,
} from '../../worker/src/lib/r2';
import type { Bindings } from '../../worker/src/types';
import {
  importDatasetToD1,
  isFirebaseStorageUrl,
  migrateDatasetMediaToR2,
  normalizeSnapshot,
  resolveFirebaseDownloadUrl,
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

async function migrateExistingD1Rows(
  env: Bindings,
  publicBaseUrl: string | null,
  dryRun: boolean,
) {
  let scanned = 0;
  let migrated = 0;
  let failed = 0;
  const failures: Array<{ sourceUrl: string; reason: string }> = [];
  const cache = new Map<string, string>();
  const now = Date.now();

  async function migrateUrl(
    url: string | null | undefined,
    meta: { ownerId: string; purpose: MediaPurpose; entityType: MediaEntityType; entityId: string },
  ): Promise<string | null> {
    if (!url || !isFirebaseStorageUrl(url)) return url ?? null;
    scanned += 1;
    const hit = cache.get(url);
    if (hit) return hit;

    const resolved = resolveFirebaseDownloadUrl(url);
    if (!resolved) {
      failed += 1;
      failures.push({ sourceUrl: url, reason: 'Unrecognized Firebase Storage URL format.' });
      return url;
    }

    if (dryRun) {
      migrated += 1;
      return url;
    }

    try {
      const res = await fetch(resolved.downloadUrl, { method: 'GET' });
      if (!res.ok) {
        failed += 1;
        failures.push({ sourceUrl: url, reason: `HTTP ${res.status}` });
        return url;
      }
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes.byteLength <= 0 || bytes.byteLength > MAX_SIZE_BYTES_BY_PURPOSE[meta.purpose]) {
        failed += 1;
        failures.push({ sourceUrl: url, reason: `Invalid size (${bytes.byteLength} bytes)` });
        return url;
      }
      const mime = detectMagicMimeType(bytes);
      if (!mime || !allowedMimeTypesForPurpose(meta.purpose).has(mime)) {
        failed += 1;
        failures.push({ sourceUrl: url, reason: `Invalid signature (${mime ?? 'unknown'})` });
        return url;
      }

      const visibility = defaultVisibilityForPurpose(meta.purpose);
      const key = buildUniqueMediaKey({
        purpose: meta.purpose,
        visibility,
        ownerId: meta.ownerId,
        contentType: mime,
        nowMs: now,
      });
      const sha256 = await sha256Hex(buf);
      await env.MEDIA_BUCKET.put(key, buf, {
        httpMetadata: {
          contentType: mime,
          cacheControl:
            visibility === 'private' ? 'private, no-store' : 'public, max-age=31536000, immutable',
        },
        customMetadata: {
          ownerId: meta.ownerId,
          purpose: meta.purpose,
          visibility,
          migratedFrom: url.slice(0, 200),
        },
      });

      await env.DB.prepare(
        `INSERT INTO media_objects (
          key, owner_id, purpose, entity_type, entity_id, visibility,
          content_type, size_bytes, sha256, original_filename, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO NOTHING`,
      )
        .bind(
          key,
          meta.ownerId,
          meta.purpose,
          meta.entityType,
          meta.entityId,
          visibility,
          mime,
          bytes.byteLength,
          sha256,
          resolved.originalFilename,
          now,
          now,
        )
        .run();

      const nextUrl = buildMediaDeliveryUrl(key, visibility, publicBaseUrl);
      cache.set(url, nextUrl);
      migrated += 1;
      return nextUrl;
    } catch (err) {
      failed += 1;
      failures.push({ sourceUrl: url, reason: err instanceof Error ? err.message : 'Fetch error' });
      return url;
    }
  }

  const users = await env.DB
    .prepare("SELECT id, image FROM user WHERE image LIKE '%firebasestorage%' OR image LIKE 'gs://%'")
    .all<{ id: string; image: string }>();
  for (const u of users.results) {
    const next = await migrateUrl(u.image, { ownerId: u.id, purpose: 'avatar', entityType: 'user', entityId: u.id });
    if (!dryRun && next && next !== u.image) {
      await env.DB.prepare('UPDATE user SET image = ?, updated_at = ? WHERE id = ?').bind(next, now, u.id).run();
    }
  }

  const businesses = await env.DB
    .prepare(
      `SELECT id, owner_id, logo_url, cover_image_url, gallery_json FROM businesses
       WHERE logo_url LIKE '%firebasestorage%' OR logo_url LIKE 'gs://%'
          OR cover_image_url LIKE '%firebasestorage%' OR cover_image_url LIKE 'gs://%'
          OR gallery_json LIKE '%firebasestorage%' OR gallery_json LIKE '%gs://%'`,
    )
    .all<{
      id: string;
      owner_id: string;
      logo_url: string | null;
      cover_image_url: string | null;
      gallery_json: string;
    }>();
  for (const b of businesses.results) {
    const nextLogo = await migrateUrl(b.logo_url, {
      ownerId: b.owner_id,
      purpose: 'business_logo',
      entityType: 'business',
      entityId: b.id,
    });
    const nextCover = await migrateUrl(b.cover_image_url, {
      ownerId: b.owner_id,
      purpose: 'business_photo',
      entityType: 'business',
      entityId: b.id,
    });
    let nextGallery = b.gallery_json;
    try {
      const arr = JSON.parse(b.gallery_json) as unknown[];
      if (Array.isArray(arr)) {
        const out: string[] = [];
        for (const item of arr) {
          if (typeof item !== 'string') continue;
          const m = await migrateUrl(item, {
            ownerId: b.owner_id,
            purpose: 'business_gallery',
            entityType: 'business',
            entityId: b.id,
          });
          if (m) out.push(m);
        }
        nextGallery = JSON.stringify(out);
      }
    } catch {
      // keep malformed JSON intact
    }

    if (!dryRun && (nextLogo !== b.logo_url || nextCover !== b.cover_image_url || nextGallery !== b.gallery_json)) {
      await env.DB
        .prepare(
          'UPDATE businesses SET logo_url = ?, cover_image_url = ?, gallery_json = ?, updated_at = ? WHERE id = ?',
        )
        .bind(nextLogo, nextCover, nextGallery, now, b.id)
        .run();
    }
  }

  const ads = await env.DB
    .prepare(
      `SELECT id, owner_id, image_url, additional_images_json FROM marketplace_items
       WHERE image_url LIKE '%firebasestorage%' OR image_url LIKE 'gs://%'
          OR additional_images_json LIKE '%firebasestorage%' OR additional_images_json LIKE '%gs://%'`,
    )
    .all<{
      id: string;
      owner_id: string;
      image_url: string;
      additional_images_json: string;
    }>();
  for (const ad of ads.results) {
    const nextMain =
      (await migrateUrl(ad.image_url, {
        ownerId: ad.owner_id,
        purpose: 'marketplace_image',
        entityType: 'marketplace_item',
        entityId: ad.id,
      })) ?? ad.image_url;
    let nextExtras = ad.additional_images_json;
    try {
      const arr = JSON.parse(ad.additional_images_json) as unknown[];
      if (Array.isArray(arr)) {
        const out: string[] = [];
        for (const item of arr) {
          if (typeof item !== 'string') continue;
          const m = await migrateUrl(item, {
            ownerId: ad.owner_id,
            purpose: 'marketplace_image',
            entityType: 'marketplace_item',
            entityId: ad.id,
          });
          if (m) out.push(m);
        }
        nextExtras = JSON.stringify(out);
      }
    } catch {
      // ignore
    }

    if (!dryRun && (nextMain !== ad.image_url || nextExtras !== ad.additional_images_json)) {
      await env.DB
        .prepare(
          'UPDATE marketplace_items SET image_url = ?, additional_images_json = ?, updated_at = ? WHERE id = ?',
        )
        .bind(nextMain, nextExtras, now, ad.id)
        .run();
    }
  }

  const claims = await env.DB
    .prepare(
      `SELECT id, claimant_id, proof_attachment_url FROM claims
       WHERE proof_attachment_url LIKE '%firebasestorage%' OR proof_attachment_url LIKE 'gs://%'`,
    )
    .all<{ id: string; claimant_id: string; proof_attachment_url: string }>();
  for (const cl of claims.results) {
    const nextProof = await migrateUrl(cl.proof_attachment_url, {
      ownerId: cl.claimant_id,
      purpose: 'claim_proof',
      entityType: 'claim',
      entityId: cl.id,
    });
    if (!dryRun && nextProof && nextProof !== cl.proof_attachment_url) {
      await env.DB
        .prepare('UPDATE claims SET proof_attachment_url = ? WHERE id = ?')
        .bind(nextProof, cl.id)
        .run();
    }
  }

  return { scanned, migrated, failed, failures };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const isRemote = args.remote === 'true';
  const envName = args.env;
  const confirmRemote = args['confirm-remote'] === 'true';
  const dryRun = args['dry-run'] === 'true';

  if (isRemote) {
    if (!envName || !['development', 'production'].includes(envName)) {
      throw new Error('When using --remote, specify --env development or --env production.');
    }
    if (!confirmRemote) {
      throw new Error(
        'Refusing to touch remote D1/R2 without explicit --confirm-remote approval flag.',
      );
    }
  }

  const proxy = await getPlatformProxy<Bindings>({
    environment: isRemote ? envName : undefined,
    persist: !isRemote,
  });

  try {
    const publicBaseUrl = args['public-base-url'] || proxy.env.R2_PUBLIC_BASE_URL || null;

    if (args['from-d1'] === 'true') {
      const report = await migrateExistingD1Rows(proxy.env, publicBaseUrl, dryRun);
      console.log('[migrate-storage] D1 -> R2 summary:', report);
      return;
    }

    const inputPath = path.resolve(process.cwd(), args.input || 'tmp/firestore-export.json');
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Snapshot file not found: ${inputPath}`);
    }

    const snapshot = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as FirestoreExportSnapshot;
    const dataset = normalizeSnapshot(snapshot);
    const summary = await migrateDatasetMediaToR2(dataset, {
      bucket: proxy.env.MEDIA_BUCKET,
      publicBaseUrl,
    });

    if (!dryRun) {
      await importDatasetToD1(proxy.env.DB, dataset);
    }

    const outPath = path.resolve(
      process.cwd(),
      args.out || 'tmp/firestore-export.r2-migrated.json',
    );
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(dataset, null, 2), 'utf8');

    console.log('[migrate-storage] Summary:', summary);
    console.log(`[migrate-storage] Migrated dataset written to ${outPath}`);
  } finally {
    await proxy.dispose();
  }
}

main().catch((err) => {
  console.error('[migrate-storage] Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
