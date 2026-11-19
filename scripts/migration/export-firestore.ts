/**
 * Non-destructive Firebase Firestore exporter for NaijaPages (Phase 4).
 *
 * Strictly READ-ONLY: uses Firestore REST API listDocuments over HTTPS and never
 * writes, updates, or deletes any document in Firestore.
 *
 * Authentication options (checked in order):
 *   1. GOOGLE_ACCESS_TOKEN env var (short-lived OAuth2 bearer token)
 *   2. GOOGLE_APPLICATION_CREDENTIALS path to a Firebase Service Account JSON key
 *      (exchanges a self-signed RS256 JWT with Google OAuth2 for a read-only token)
 *
 * Usage:
 *   npx tsx scripts/migration/export-firestore.ts --out tmp/firestore-export.json
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  decodeFirestoreDocument,
  type FirestoreDoc,
  type FirestoreExportSnapshot,
  type FirestoreRestValue,
} from './lib';

const COLLECTIONS = [
  'users',
  'admins',
  'bans',
  'businesses',
  'marketplace_items',
  'reviews',
  'favourites',
  'claims',
  'reports',
  'listing_overrides',
  'contact_messages',
  'newsletter_subscribers',
  'site_settings',
  'audit_log',
] as const;

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

async function getAccessTokenFromServiceAccount(keyPath: string): Promise<string> {
  const raw = JSON.parse(fs.readFileSync(keyPath, 'utf8')) as {
    client_email: string;
    private_key: string;
    token_uri?: string;
  };
  const tokenUri = raw.token_uri || 'https://oauth2.googleapis.com/token';
  const nowSec = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      iss: raw.client_email,
      scope: 'https://www.googleapis.com/auth/datastore.readonly',
      aud: tokenUri,
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  ).toString('base64url');

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  signer.end();
  const signature = signer.sign(raw.private_key, 'base64url');
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to exchange service account JWT (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('Token response did not include access_token.');
  return json.access_token;
}

async function listCollectionDocs(
  projectId: string,
  databaseId: string,
  collectionId: string,
  token: string,
): Promise<FirestoreDoc[]> {
  const docs: FirestoreDoc[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${encodeURIComponent(collectionId)}`,
    );
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 404) {
      return [];
    }
    if (!res.ok) {
      throw new Error(`Firestore read failed for ${collectionId} (${res.status}): ${await res.text()}`);
    }

    const body = (await res.json()) as {
      documents?: Array<{
        name: string;
        fields?: Record<string, FirestoreRestValue>;
        createTime?: string;
        updateTime?: string;
      }>;
      nextPageToken?: string;
    };

    for (const d of body.documents ?? []) {
      docs.push(decodeFirestoreDocument(d));
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  return docs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = path.resolve(process.cwd(), args.out || 'tmp/firestore-export.json');

  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const firebaseConfig = fs.existsSync(configPath)
    ? (JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
        projectId?: string;
        firestoreDatabaseId?: string;
      })
    : {};

  const projectId = args.project || process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId || '';
  const databaseId =
    args.database ||
    process.env.FIRESTORE_DATABASE_ID ||
    firebaseConfig.firestoreDatabaseId ||
    '(default)';

  if (!projectId) {
    throw new Error('Missing Firebase projectId. Pass --project <id> or ensure firebase-applet-config.json exists.');
  }

  let token = process.env.GOOGLE_ACCESS_TOKEN?.trim() || '';
  if (!token) {
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
    if (!keyPath || !fs.existsSync(keyPath)) {
      throw new Error(
        'Provide GOOGLE_ACCESS_TOKEN or GOOGLE_APPLICATION_CREDENTIALS pointing to a Firebase service account JSON key.',
      );
    }
    token = await getAccessTokenFromServiceAccount(keyPath);
  }

  const collections = {} as FirestoreExportSnapshot['collections'];
  for (const col of COLLECTIONS) {
    const docs = await listCollectionDocs(projectId, databaseId, col, token);
    collections[col] = docs;
    console.log(`[export] ${col}: ${docs.length} document(s)`);
  }

  const snapshot: FirestoreExportSnapshot = {
    version: 1,
    exportedAt: new Date().toISOString(),
    projectId,
    databaseId,
    collections,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const serialized = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(outPath, serialized, 'utf8');
  const sha256 = crypto.createHash('sha256').update(serialized).digest('hex');

  console.log(`\nExport complete (read-only): ${outPath}`);
  console.log(`SHA-256: ${sha256}`);
}

main().catch((err) => {
  console.error('[export-firestore] Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
