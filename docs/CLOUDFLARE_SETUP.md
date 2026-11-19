# Cloudflare Backend Infrastructure, Auth, D1 Data & R2 Storage (Phases 2–5)

This document describes the Cloudflare Workers + D1 + R2 + KV backend infrastructure (Phase 2), Better Auth authentication layer (Phase 3), Cloudflare D1 relational data layer (Phase 4), and Cloudflare R2 object storage layer (Phase 5) of the Firebase-to-Cloudflare migration.

> **Scope note (Phase 5):** Authentication, relational data, and media uploads/delivery (user avatars, business logos, cover photos, galleries, marketplace photos, and private claim proofs) now run on Cloudflare Workers + D1 + R2 under `/api/v1/*` and `/api/media/*`. Firebase client config (`src/lib/firebase.ts`, `firebase-applet-config.json`, `firestore.rules`) and existing Firebase data remain untouched until final cleanup.

---

## 1. Backend Architecture

```text
wrangler.toml                  # Worker config, [assets], local defaults, [env.development], [env.production]
.dev.vars.example              # Template for local Worker secrets (.dev.vars is gitignored)
scripts/migration/
  lib.ts                       # Firestore/Storage -> D1/R2 normalization, SQL generator, integrity checks
  export-firestore.ts          # Strictly read-only Firestore REST snapshot exporter
  import-d1.ts                 # Idempotent D1 importer (local by default; requires --confirm-remote for remote)
  migrate-storage.ts           # Non-destructive Firebase Storage -> R2 migrator & D1 URL rewriter
  verify-d1.ts                 # Record-count, FK, admin/ban parity, rating, and Firebase media ref verifier
  migration.test.ts            # End-to-end Miniflare D1/R2 import, storage migration, and integrity tests
worker/
  tsconfig.json                # Strict TypeScript config using @cloudflare/workers-types
  migrations/
    0001_initial_schema.sql    # Base relational D1 schema (auth, directory, marketplace, moderation, settings)
    0002_phase4_relational_data.sql # Categories (seeded), category FKs, favourites, admin_records, user_bans, indexes
    0003_phase5_r2_media.sql   # media_objects ownership/visibility table + business cover/gallery + claim proof URL
  src/
    index.ts                   # Hono app factory (`createApp`) + Worker entrypoint + SPA asset fallback
    types.ts                   # Strongly typed Cloudflare Bindings, AuthSessionUser & Hono AppEnv
    auth.ts                    # Better Auth instance (D1 Drizzle adapter, PBKDF2, Google OAuth, linking, verification)
    db/
      schema.ts                # Drizzle SQLite schema covering all 18 D1 tables
    lib/
      db.ts                    # D1 connectivity & schema readiness check
      email.ts                 # Resend HTTP API transactional emails + non-prod dev link logger
      kv.ts                    # KV fixed-window rate limiter & health probe
      password.ts              # WebCrypto PBKDF2-SHA256 hashing & constant-time verification
      r2.ts                    # Magic-byte validation, size caps, unique R2 key builder, delivery URLs & health probe
      response.ts              # Consistent JSON success/error envelopes
      routeHelpers.ts          # Shared JSON body & query param parsing + error mapper
      validation.ts            # Server-side input validation, URL/social sanitization & limits
    middleware/
      auth.ts                  # Better Auth + D1 admin_records/user_bans session guards
      cors.ts                  # Origin allowlist parser & Hono CORS middleware
      rateLimit.ts             # KV-backed IP rate limiting middleware for /api/auth/* & /api/v1/*
    services/
      mappers.ts               # D1 row -> frontend JSON mappers with URL/text re-sanitization
      mediaService.ts          # R2 upload, replacement, deletion, private access control & D1 reference cleanup
      directoryService.ts      # Directory queries, pagination/search, submissions, reviews, favourites, claims, reports
      marketplaceService.ts    # Marketplace queries, pagination/search, ad creation & verification link
      adminService.ts          # Atomic db.batch admin moderation mutations + audit_log enforcement
    routes/
      auth.ts                  # GET /api/auth/providers + Better Auth handler (/api/auth/*)
      health.ts                # GET /api/health, GET /api/health/bindings
      media.ts                 # /api/media/* upload, replace, delete, public CDN/proxy & private authorized delivery
      directory.ts             # /api/v1/directory/* public & member endpoints
      marketplace.ts           # /api/v1/marketplace/* endpoints
      admin.ts                 # /api/v1/admin/* admin-protected moderation endpoints
      v1.ts                    # /api/v1/status, /me/avatar, /me/submissions, /claims, /reports, /contact, /newsletter
    worker.test.ts             # Unit/integration tests for routes, guards, CORS, and rate limiting
    auth.test.ts               # Real Miniflare D1 integration tests for Better Auth flows & Google linking
    data.test.ts               # Real Miniflare D1 integration tests for Phase 4 directory, marketplace & admin APIs
    media.test.ts              # Real Miniflare D1+R2 integration tests for uploads, magic-bytes, replace, delete & private access
```

### Binding Responsibilities

| Binding | Cloudflare Service | Purpose |
| --- | --- | --- |
| `DB` | Cloudflare D1 | Primary relational SQLite database (`user`, `session`, `account`, `verification`, `businesses`, `marketplace_items`, `reviews`, `claims`, `reports`, `listing_overrides`, `contact_messages`, `newsletter_subscribers`, `site_settings`, `audit_log`) |
| `MEDIA_BUCKET` | Cloudflare R2 | Object storage for business photos, marketplace product images, and user avatars |
| `RATE_LIMIT_KV` | Cloudflare KV | Edge rate limiting for `/api/auth/*` and `/api/v1/*` and short-lived public caching (never primary relational state) |
| `ASSETS` | Workers Static Assets | Serves `./dist` Vite React SPA bundle with `run_worker_first = ["/api/*"]` |

---

## 2. Local Development & Testing Commands

1. **Apply the initial D1 schema locally (Miniflare SQLite):**
   ```bash
   npm run cf:db:migrate:local
   ```

2. **Build the frontend SPA (`./dist`) so Workers Static Assets can serve it:**
   ```bash
   npm run build
   ```

3. **Run the Worker locally on port `8787`:**
   ```bash
   npm run cf:dev
   ```
   Test endpoints while `cf:dev` is running:
   - `GET http://127.0.0.1:8787/api/health` — Worker liveness probe
   - `GET http://127.0.0.1:8787/api/health/bindings` — Live D1 (`schemaReady: true`), R2, and KV health check
   - `GET http://127.0.0.1:8787/api/v1/status` — Migration phase & feature flags

4. **Typecheck & run Worker + Migration tests:**
   ```bash
   npm run lint      # Checks both frontend (tsconfig.json) and Worker (worker/tsconfig.json)
   npm run cf:test   # Runs Worker unit/integration tests and D1+R2 migration tests via tsx --test
   ```

5. **Migrate Firebase Storage assets to R2 (non-destructive, local by default):**
   ```bash
   npm run cf:migrate:storage -- --input tmp/firestore-export.json
   # Or scan existing D1 rows:
   npm run cf:migrate:storage -- --from-d1
   # Verify record counts & ensure 0 remaining Firebase Storage references:
   npm run cf:migrate:verify:local
   ```

---

## 3. Environment Variables & Secrets

### Non-secret Variables (`wrangler.toml` `[vars]`)
Configured per environment (`[vars]`, `[env.development.vars]`, `[env.production.vars]`):
- `APP_ENV`: `"development"` or `"production"`
- `APP_NAME`: `"NaijaPages"`
- `APP_URL`: Canonical origin for the environment
- `CORS_ORIGINS`: Comma-separated list of allowed browser origins
- `REQUIRE_VERIFIED_EMAIL`: `"true"` or `"false"`
- `R2_PUBLIC_BASE_URL`: Optional custom domain for public R2 media delivery (e.g. `https://media.naijapages.ng`)

### Worker Secrets (`.dev.vars` locally / `wrangler secret put` remotely)
Never commit these values to git or `wrangler.toml`:
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `TURNSTILE_SECRET_KEY`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `BOOTSTRAP_ADMIN_EMAIL`

### Frontend Vite Variables (`.env.example`)
- `VITE_API_BASE_URL`: Worker API origin when running Vite (`:3000`) separately from Wrangler (`:8787`)
- `VITE_TURNSTILE_SITE_KEY`: Public Turnstile widget site key
- `VITE_R2_PUBLIC_BASE_URL`: Optional public R2 CDN domain

---

## 4. Required Manual Cloudflare Dashboard / CLI Configuration

Before deploying to remote `development` or `production` environments, perform these one-time setup steps with your Cloudflare account:

1. **Authenticate Wrangler CLI**
   ```bash
   npx wrangler login
   ```
   Verify account access with `npx wrangler whoami`.

2. **Create Remote D1 Databases & Update `wrangler.toml`**
   ```bash
   npx wrangler d1 create naijapages-db-dev
   npx wrangler d1 create naijapages-db-prod
   ```
   Copy the returned `database_id` UUIDs into `[[env.development.d1_databases]]` and `[[env.production.d1_databases]]` in `wrangler.toml`.

3. **Create Remote R2 Buckets**
   ```bash
   npx wrangler r2 bucket create naijapages-media-dev
   npx wrangler r2 bucket create naijapages-media-prod
   ```
   *(Optional for Phase 4+)* In the Cloudflare Dashboard → **R2** → `naijapages-media-prod` → **Settings**, attach a custom public domain (e.g., `media.naijapages.ng`) and set `R2_PUBLIC_BASE_URL` in `wrangler.toml`, or continue serving via `/api/media/:key`.

4. **Create Remote KV Namespaces & Update `wrangler.toml`**
   ```bash
   npx wrangler kv namespace create RATE_LIMIT_KV --env development
   npx wrangler kv namespace create RATE_LIMIT_KV --env production
   ```
   Copy the returned namespace IDs into `[[env.development.kv_namespaces]]` and `[[env.production.kv_namespaces]]` in `wrangler.toml`.

5. **Configure Cloudflare Turnstile (for Phase 3+ forms & auth)**
   - Cloudflare Dashboard → **Turnstile** → **Add widget** for your dev/prod domains.
   - Save the **Site Key** (`VITE_TURNSTILE_SITE_KEY`) and **Secret Key** (`TURNSTILE_SECRET_KEY`).

6. **Configure Google OAuth Credentials (for Phase 3+ Better Auth)**
   - Google Cloud Console → **APIs & Services → Credentials → OAuth 2.0 Client IDs**.
   - Add authorized JavaScript origins (`https://dev.naijapages.example.com`, `https://naijapages.ng`).
   - Add authorized redirect URIs (`<BETTER_AUTH_URL>/api/auth/callback/google`).

7. **Configure Transactional Email Domain (Resend)**
   - Verify your sending domain (e.g., `naijapages.ng`) in Resend (DNS SPF/DKIM records in Cloudflare DNS).

8. **Upload Secrets & Run Remote Migrations**
   ```bash
   npx wrangler secret put BETTER_AUTH_SECRET --env development
   npx wrangler secret put BETTER_AUTH_URL --env development
   npx wrangler secret put GOOGLE_CLIENT_ID --env development
   npx wrangler secret put GOOGLE_CLIENT_SECRET --env development
   npx wrangler secret put TURNSTILE_SECRET_KEY --env development
   npx wrangler secret put RESEND_API_KEY --env development
   npx wrangler secret put EMAIL_FROM --env development
   npx wrangler secret put BOOTSTRAP_ADMIN_EMAIL --env development

   npm run cf:db:migrate:dev
   npm run cf:deploy:dev
   ```
   Repeat with `--env production` (`cf:db:migrate:prod`, `cf:deploy:prod`) when ready for production.
