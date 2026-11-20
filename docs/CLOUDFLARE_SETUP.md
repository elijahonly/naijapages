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

1. **Apply the D1 schema locally (Miniflare SQLite under `--env development`):**
   ```bash
   npm run cf:db:migrate:local
   ```

2. **Build the frontend SPA (`./dist`) so Workers Static Assets can serve it:**
   ```bash
   npm run build
   ```

3. **Run the Worker locally on port `8787` (explicitly using `--env development`):**
   ```bash
   npm run cf:dev
   ```
   Test endpoints while `cf:dev` is running:
   - `GET http://127.0.0.1:8787/api/health` — Worker liveness probe
   - `GET http://127.0.0.1:8787/api/health/bindings` — Live D1 (`schemaReady: true`), R2, and KV health check
   - `GET http://127.0.0.1:8787/api/v1/status` — Migration phase & feature flags

4. **Typecheck, validate Wrangler config, & run Worker + Migration tests:**
   ```bash
   npm run lint        # Checks both frontend (tsconfig.json) and Worker (worker/tsconfig.json)
   npm run cf:test     # Runs Worker unit/integration tests and D1+R2 migration tests via tsx --test
   npm run cf:validate # Builds ./dist and runs `wrangler deploy --env production --dry-run`
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

### Non-secret Variables (`wrangler.toml`)
Environments are strictly separated in `wrangler.toml`:
- **`[env.production]`** (and the production-safe top-level fallback):
  - `APP_ENV = "production"`
  - `APP_URL = "https://naijapages.ng"`
  - `CORS_ORIGINS = "https://naijapages.ng,https://www.naijapages.ng"`
  - `REQUIRE_VERIFIED_EMAIL = "true"`
  - `R2_PUBLIC_BASE_URL = ""` (serves public media via same-origin `/api/media/*` until a custom R2 public domain such as `https://media.naijapages.ng` is attached)
  - Bindings: `DB` (`naijapages-db-prod`), `MEDIA_BUCKET` (`naijapages-media-prod`), `RATE_LIMIT_KV`, `ASSETS` (`./dist`)
- **`[env.development]`** (local dev & staging):
  - `APP_ENV = "development"`
  - `APP_URL = "http://localhost:3000"`
  - `CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8787,http://127.0.0.1:8787"`
  - `REQUIRE_VERIFIED_EMAIL = "true"`
  - `R2_PUBLIC_BASE_URL = ""`
  - Bindings: `DB` (`naijapages-db-dev`), `MEDIA_BUCKET` (`naijapages-media-dev`), `RATE_LIMIT_KV`, `ASSETS` (`./dist`)

### Worker Secrets (`.dev.vars` locally / `wrangler secret put` remotely)
Never commit these values to git or `wrangler.toml`:
- `BETTER_AUTH_SECRET` *(required in production — must be a random 32+ character string; placeholders and dev defaults are rejected)*
- `BETTER_AUTH_URL` *(e.g. `https://naijapages.ng` in production)*
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

## 4. Production Deployment & Cloudflare Resource Setup

Before deploying to remote `production` (or `development` staging), perform these one-time setup steps with your Cloudflare account:

1. **Authenticate Wrangler CLI**
   ```bash
   npx wrangler login
   npx wrangler whoami
   ```

2. **Create Remote D1 Databases & Pin Their Real IDs in `wrangler.toml`**
   ```bash
   npx wrangler d1 create naijapages-db-prod
   # Optional staging database:
   npx wrangler d1 create naijapages-db-dev
   ```
   Uncomment `database_id` and paste the returned production UUID into both `[[d1_databases]]` (top-level fallback) and `[[env.production.d1_databases]]` in `wrangler.toml`. If you created a staging DB, paste its UUID into `[[env.development.d1_databases]]`.

3. **Create Remote R2 Buckets**
   ```bash
   npx wrangler r2 bucket create naijapages-media-prod
   # Optional staging bucket:
   npx wrangler r2 bucket create naijapages-media-dev
   ```
   *(Optional)* In the Cloudflare Dashboard → **R2** → `naijapages-media-prod` → **Settings**, attach a custom public domain (e.g., `media.naijapages.ng`) and set `R2_PUBLIC_BASE_URL = "https://media.naijapages.ng"` under `[env.production.vars]` (and top-level `[vars]`), or leave it empty to serve media through `/api/media/*`.

4. **Create the Production KV Namespace for Rate Limiting & Pin Its ID**
   ```bash
   npx wrangler kv namespace create RATE_LIMIT_KV --env production
   # Optional staging namespace:
   npx wrangler kv namespace create RATE_LIMIT_KV --env development
   ```
   Uncomment `id` and paste the returned production namespace ID into both `[[kv_namespaces]]` (top-level fallback) and `[[env.production.kv_namespaces]]` in `wrangler.toml`.
   > **Note:** Never commit placeholder IDs like `00000000000000000000000000000001`. When `id` is omitted, Wrangler v4 inherits an existing binding or auto-provisions a namespace, and `worker/src/lib/kv.ts` includes a bounded in-memory rate-limit fallback for local/unprovisioned environments. Pinning the real production namespace ID ensures deterministic distributed rate limiting across edge isolates.

5. **Configure Cloudflare Turnstile, Google OAuth & Resend**
   - **Turnstile**: Create a widget for `naijapages.ng` / `www.naijapages.ng` and save `VITE_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`.
   - **Google OAuth**: Add `https://naijapages.ng` as an authorized JavaScript origin and `https://naijapages.ng/api/auth/callback/google` as an authorized redirect URI.
   - **Resend**: Verify your sending domain in Resend (SPF/DKIM in Cloudflare DNS).

6. **Upload Production Secrets & Run Remote D1 Migrations**
   ```bash
   npx wrangler secret put BETTER_AUTH_SECRET --env production
   npx wrangler secret put BETTER_AUTH_URL --env production
   npx wrangler secret put GOOGLE_CLIENT_ID --env production
   npx wrangler secret put GOOGLE_CLIENT_SECRET --env production
   npx wrangler secret put TURNSTILE_SECRET_KEY --env production
   npx wrangler secret put RESEND_API_KEY --env production
   npx wrangler secret put EMAIL_FROM --env production
   npx wrangler secret put BOOTSTRAP_ADMIN_EMAIL --env production

   npm run cf:db:migrate:prod
   ```

7. **Deploy to Production (CLI or Cloudflare Workers Git Builds)**
   - **CLI**:
     ```bash
     npm run cf:validate     # Build + dry-run check
     npm run cf:deploy:prod  # Runs: npm run build && wrangler deploy --env production
     # (or `npm run deploy`, which runs the same production deploy command)
     ```
   - **Cloudflare Dashboard → Workers & Pages → Builds & Deployments**:
     - **Build command**: `npm run build`
     - **Deploy command**: `npx wrangler deploy --env production`
     - *(Or set build environment variable `CLOUDFLARE_ENV=production`.)*

