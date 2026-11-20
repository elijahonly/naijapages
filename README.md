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

- **Cloudflare D1** (`DB`) — relational SQLite database for users, sessions, businesses, marketplace ads, reviews, ownership claims, reports, favourites, contact messages, subscribers, settings, audit logs, and the business discovery/evidence/monitoring tables.
- **Cloudflare R2** (`MEDIA_BUCKET`) — object storage for member avatars, business logos/covers/galleries, and marketplace photos served via `/api/media/*`.
- **Cloudflare KV** (`RATE_LIMIT_KV`) — distributed rate-limiting counters and short-lived source response caching in production (with a bounded in-memory fallback for local development).
- **Cloudflare Queues & Cron Triggers** (`DISCOVERY_QUEUE`) — asynchronous, bounded job orchestration for nationwide authentic business discovery and lifecycle monitoring (disabled by default via `DISCOVERY_ENABLED="false"`).

See **[docs/CLOUDFLARE_SETUP.md](docs/CLOUDFLARE_SETUP.md)** for provisioning, secrets (`BETTER_AUTH_SECRET`, OAuth/Resend/Turnstile keys), D1 migrations, and deployment instructions, and **[docs/business-discovery/architecture-and-operations.md](docs/business-discovery/architecture-and-operations.md)** for the nationwide discovery & monitoring architecture.

The admin site lives at **`https://your-site/#/admin`** (lazy-loaded only when opened), including the **Business Intelligence** workspace at **`#/admin/intelligence`**.

## 3. Data integrity & listing verification

NaijaPages ships **zero synthetic, placeholder, or preloaded fake businesses or marketplace ads**. Only Nigerian geographic reference data (36 States + FCT, LGAs, geopolitical zones, business/marketplace categories, and official emergency hotlines) is bundled in `src/data/`.

Every public business listing comes either from genuine member submissions or from verified, legally compliant public discovery sources with traceable evidence:

| Status / Origin | Meaning |
|---|---|
| **Pending (Member)** | Newly submitted by a signed-in member with a verified email. Hidden from public search until an administrator reviews and approves it. |
| **Approved (Unverified)** | Published member listing or corroborated public-source listing (`Unverified · Public source` with required source attribution such as `© OpenStreetMap contributors`). Never falsely badged as Owner Verified. |
| **Approved & Owner Verified** | Independently checked by an administrator (for example against CAC records or ownership proof) and awarded the **Verified** badge. Only approved, verified businesses are eligible for the daily Featured spotlight. |
| **Rejected / Removed / Archived** | Hidden from public search; archived closed listings preserve full evidence and change history for auditability and one-click restoration. |

## 4. Day-to-day moderation & business intelligence

- **[docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md)** — moderation workflows (approving/verifying businesses, moderating marketplace ads, handling reports and ownership claims, managing members/admins, and editing site settings).
- **[docs/business-discovery/architecture-and-operations.md](docs/business-discovery/architecture-and-operations.md)** — operating the nationwide discovery bot, approving sources, reviewing candidates, monitoring closures, and pausing/recovering jobs.
- **[docs/SECURITY.md](docs/SECURITY.md)** — security architecture and production hardening checklist.

## Project layout

```
wrangler.toml              Cloudflare Workers environments (development & production), Queues, Cron & bindings
config/security-headers.ts Content-Security-Policy + HTTP security headers
worker/
  src/                     Hono Worker API, Better Auth, D1 routes, R2 media handler, KV rate limiter, Discovery Intelligence engine
  migrations/              Versioned Cloudflare D1 SQL migrations (0001..0005)
docs/
  business-discovery/      Discovery architecture, OSM ODbL notes, and documented rollback SQL
src/
  App.tsx, Root.tsx        Public site + hash router (#/, #/marketplace, #/about, #/contact, #/admin)
  pages/                   About and Contact pages
  components/              Public UI (cards, modals, QR generator, search, header, footer)
  context/                 Auth (Better Auth session & roles) and DataContext (Cloudflare D1 bootstrap)
  services/                Directory filtering/sorting and API write helpers
  lib/                     config, security validation, QR code utilities, daily-pick engine, router
  admin/                   Admin console + Business Intelligence dashboard (loaded only when /#/admin is opened)
  data/                    Nigerian States/LGAs, categories, safety tips, emergency numbers (no fake listings)
```

