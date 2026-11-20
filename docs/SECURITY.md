# Security guide

## How protection is layered

| Layer | What it stops | Where it lives |
|---|---|---|
| **Worker API & D1 authorization** | Unauthenticated writes, self-approving listings, faking ratings or Verified badges, reading private queues, escalating to admin, or posting while suspended | `worker/src/routes/*`, `worker/src/middleware/*` |
| **Authentication (Better Auth)** | Anonymous spam and session forgery. Listing businesses, posting ads, writing reviews, claiming listings, and reporting require a signed-in member with a **verified email** (configurable) | `worker/src/lib/auth.ts`, `src/context/AuthContext.tsx` |
| **Admin-only moderation** | Only users present in D1 `admin_records` can access `/api/v1/admin/*` endpoints to approve, verify, edit, remove, suspend, or view private reports/messages | `worker/src/routes/admin.ts` |
| **Input & URL validation** | `javascript:` / look-alike links, spoofing characters, oversized payloads, invalid phones/emails, and unsafe media MIME types | `src/lib/security.ts`, `worker/src/lib/validation.ts`, `worker/src/routes/media.ts` |
| **Rate limiting (Cloudflare KV)** | Brute-force login attempts, contact/newsletter spam, upload floods, and abuse bursts | `worker/src/lib/kv.ts` (`RATE_LIMIT_KV` in production; bounded in-memory fallback in local dev) |
| **Browser security headers & CSP** | XSS script injection, clickjacking, MIME sniffing, referrer leakage | `config/security-headers.ts`, `worker/src/middleware/security.ts` |
| **Atomic audit trail** | Unaccountable admin modifications | D1 `audit_log` (written atomically via `DB.batch(...)` on every admin mutation) |

Frontend buttons are **conveniences**; the Cloudflare Worker middleware, Better Auth session checks, and parameterized D1 queries are the **security boundary**.

### What members can and cannot do

- **Members can**: submit business listings (always created with `status = 'pending'`, `is_verified = 0`, `rating = 0`, `reviews_count = 0`), edit their own listings, post marketplace ads, upload validated image files to R2 (`/api/v1/media/upload`), write one review per business (excluding their own), report items, submit ownership claims, and manage their own favourites.
- **Members cannot**: approve or verify listings, fabricate ratings or review counts, mark ads as verified seller/featured, review their own businesses, read other members' reports/claims/contact messages, modify `admin_records` or `user_bans`, or submit content while suspended.

## Production checklist

Before opening production traffic, verify all items in [docs/CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md):

- [ ] **Set `BETTER_AUTH_SECRET`** as a Cloudflare Worker secret (`wrangler secret put BETTER_AUTH_SECRET --env production`) using at least 32 cryptographically random bytes. The Worker rejects missing or weak/placeholder secrets in production.
- [ ] **Configure `APP_URL` and `CORS_ORIGINS`** in `[env.production.vars]` inside `wrangler.toml` to match your exact production HTTPS origin(s) — never `localhost` or `*`.
- [ ] **Bind real production Cloudflare resources**: verify `DB` (D1), `MEDIA_BUCKET` (R2), and `RATE_LIMIT_KV` (KV) in `[env.production]` point only to production resources (never local/development bindings or placeholder IDs).
- [ ] **Apply D1 migrations** to production (`npm run cf:db:migrate:prod`) and verify `/api/health/bindings` reports `schemaReady: true`.
- [ ] **Enable Cloudflare Turnstile** (`TURNSTILE_SECRET_KEY` + `VITE_TURNSTILE_SITE_KEY`) for bot protection on auth and public forms.
- [ ] **Configure email delivery** (`RESEND_API_KEY` + `EMAIL_FROM`) so verification and password-reset emails deliver reliably from your domain.
- [ ] **Admin hygiene**: keep `admin_records` limited to trusted operators and require strong passwords or OAuth with 2FA.
- [ ] **Automated D1 backups**: enable Cloudflare D1 Time Travel / scheduled exports before running any bulk maintenance queries.
- [ ] **Verify security headers**: confirm CSP, `X-Frame-Options`, `X-Content-Type-Options`, and `Referrer-Policy` headers on deployed responses.

## Automated security & regression verification

Run the repository test suite before every deployment:

```bash
npm run lint
npm run cf:test
npm run cf:validate
```

`npm run cf:test` exercises Worker security headers, CORS enforcement, Better Auth session & secret validation, admin RBAC checks, R2 media upload validation, directory/marketplace data integrity, and QR URL sanitization.

## Known operational considerations

- **Media uploads (R2)**: uploaded images are validated for allowed MIME types (`image/jpeg`, `image/png`, `image/webp`, `image/gif`), magic bytes, and size limits before being written to `MEDIA_BUCKET` and served via `/api/media/*` with safe headers.
- **Spam prevention**: combining verified member emails, Cloudflare Turnstile, KV rate limiting, pending review queues for new businesses, user reporting, and account suspensions keeps spam costly. Monitor *Admin → Reports* and *Admin → Businesses* regularly.
- **Content Security Policy**: if a legitimate third-party asset is blocked after deployment, inspect browser DevTools for CSP violations and update `config/security-headers.ts` carefully rather than disabling CSP in production.
- **Admin list pagination**: admin views load up to the 400 most recent records per queue; use search filters to locate older items.
