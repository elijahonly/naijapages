# NaijaPages — Nigeria Business Directory & Marketplace

A React + Vite + Cloudflare Workers application with a business directory covering all 36 Nigerian States and the FCT, a peer-to-peer marketplace, member authentication (Better Auth), R2 media uploads, QR code business cards, and a full **admin console** for moderation.

---

## 1. Run locally

You need **Node.js 20.19+ or 22.12+**.

```bash
npm install
npm run dev
```

`npm run dev` automatically applies local D1 SQLite migrations, starts the local Cloudflare Worker (`wrangler dev --env development --port 8787`), and starts Vite on `http://localhost:3000` (which proxies `/api/*` to the Worker).

Useful commands:

- `npm run lint` — TypeScript type check for both frontend and `worker/`
- `npm run cf:test` — unit and integration test suite (`tsx --test`)
- `npm run build` — production Vite build into `dist/`
- `npm run cf:validate` — production build + `wrangler deploy --env production --dry-run`
- `npm run cf:db:migrate:local` — apply D1 migrations to the local development database
- `npm run cf:db:migrate:prod` — apply D1 migrations to the production Cloudflare D1 database
- `npm run deploy` — build and deploy to Cloudflare Workers (`--env production`)

## 2. Cloudflare setup & production deployment

NaijaPages runs on **Cloudflare Workers + Static Assets** backed by:

- **Cloudflare D1** (`DB`) — relational SQLite database for users, sessions, businesses, marketplace ads, reviews, ownership claims, reports, favourites, contact messages, subscribers, settings, and audit logs.
- **Cloudflare R2** (`MEDIA_BUCKET`) — object storage for member avatars, business logos/covers/galleries, and marketplace photos served via `/api/media/*`.
- **Cloudflare KV** (`RATE_LIMIT_KV`) — distributed rate-limiting counters in production (with a bounded in-memory fallback for local development).

See **[docs/CLOUDFLARE_SETUP.md](docs/CLOUDFLARE_SETUP.md)** for complete provisioning, secrets (`BETTER_AUTH_SECRET`, OAuth/Resend/Turnstile keys), D1 migrations, and deployment instructions.

The admin site lives at **`https://your-site/#/admin`** (lazy-loaded only when opened).

## 3. Data integrity & listing verification

NaijaPages ships **zero synthetic, placeholder, or preloaded fake businesses or marketplace ads**. Only Nigerian geographic reference data (36 States + FCT, LGAs, geopolitical zones, business/marketplace categories, and official emergency hotlines) is bundled in `src/data/`.

Every public business listing and marketplace advertisement comes from genuine member submissions stored in Cloudflare D1:

| Status | Meaning |
|---|---|
| **Pending** | Newly submitted by a signed-in member with a verified email. Hidden from public search until an administrator reviews and approves it. |
| **Approved (Unverified)** | Reviewed and published by an administrator so visitors can discover and contact the business, without a Verified badge. |
| **Approved & Verified** | Independently checked by an administrator (for example against CAC records or ownership proof) and awarded the **Verified** badge. Only approved, verified businesses are eligible for the daily Featured spotlight. |
| **Rejected / Removed** | Not shown publicly; the owner sees the administrator's moderation note under *My Submissions*. |

## 4. Day-to-day moderation

See **[docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md)** for full moderation workflows (approving/verifying businesses, moderating marketplace ads, handling reports and ownership claims, managing members/admins, and editing site settings).

See **[docs/SECURITY.md](docs/SECURITY.md)** for the security architecture and production hardening checklist.

## Project layout

```
wrangler.toml              Cloudflare Workers environments (development & production) + bindings
config/security-headers.ts Content-Security-Policy + HTTP security headers
worker/
  src/                     Hono Worker API, Better Auth, D1 routes, R2 media handler, KV rate limiter
  migrations/              Versioned Cloudflare D1 SQL migrations
src/
  App.tsx, Root.tsx        Public site + hash router (#/, #/marketplace, #/about, #/contact, #/admin)
  pages/                   About and Contact pages
  components/              Public UI (cards, modals, QR generator, search, header, footer)
  context/                 Auth (Better Auth session & roles) and DataContext (Cloudflare D1 bootstrap)
  services/                Directory filtering/sorting and API write helpers
  lib/                     config, security validation, QR code utilities, daily-pick engine, router
  admin/                   Admin console (loaded only when /#/admin is opened)
  data/                    Nigerian States/LGAs, categories, safety tips, emergency numbers (no fake listings)
```
