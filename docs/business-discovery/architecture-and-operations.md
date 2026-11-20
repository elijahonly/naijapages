# NaijaPages Nationwide Business Discovery, Verification & Monitoring Architecture

This document is the operational and architectural guide for the NaijaPages **Business Intelligence** discovery, verification, deduplication, and continuous monitoring system built natively on Cloudflare Workers, D1, Queues, Cron Triggers, KV, and R2.

---

## 1. Architecture & Data Flow

All components operate inside the existing NaijaPages Cloudflare Worker (`worker/src/index.ts`) and Cloudflare D1 database (`DB`). There is no parallel directory or separate backend.

```text
Cloudflare Cron Trigger (0 1 * * * UTC = 02:00 Africa/Lagos)
   │  (disabled by default until DISCOVERY_ENABLED=true & DISCOVERY_SCHEDULER_ENABLED=true)
   ▼
Scheduler (worker/src/services/discovery/scheduler.ts)
   ├─ Checks D1 bot pause controls (`discovery_bot_settings`) & daily job ceiling
   ├─ Recovers stale interrupted `running` jobs
   ├─ Skips unapproved/disabled sources & circuit-open sources
   └─ Enqueues compact job pointers to Cloudflare Queue (`DISCOVERY_QUEUE`)
   ▼
Queue Consumer (worker/src/services/discovery/queueConsumer.ts)
   ├─ Atomically locks D1 job (`claimDiscoveryJob`) to prevent duplicate execution
   ├─ Checks source approval, D1 pause switches, and source circuit breaker
   ├─ Dispatches to registered Source Adapter (`sources/registry.ts`)
   │    ├─ OpenStreetMap Overpass (`openstreetmap_overpass`)
   │    ├─ Official Business Website JSON-LD (`official_website_structured`)
   │    └─ Authorised Open Registry / Chamber JSON Feed (`authorised_open_registry`)
   ├─ Persists candidates + append-only evidence into `discovered_businesses` & `business_evidence`
   ├─ Records coverage cell scan cooldown (`discovery_coverage_cells`)
   └─ Routes permanent / exhausted failures to Dead-Letter Queue (`naijapages-discovery-dlq`)
   ▼
Verification, Deduplication & Controlled Publishing
   ├─ Normalization (`normalization.ts`): Nigerian E.164 phone parsing, canonical domains, SSRF guardrails, text sanitization
   ├─ Branch-Aware Deduplication (`deduplication.ts`): never merges branches or name-only matches; flags conflicts
   ├─ Evidence Scoring (`verification.ts`): multi-source corroboration, contradiction/closure penalties
   └─ Controlled Publishing Gate:
        • High-confidence multi-source records -> eligible for `published` (strictly NOT Owner Verified)
        • Single-source / moderate / conflicting -> `bot_review_queue` for Admin review
   ▼
Public Directory Unification (`worker/src/services/directoryService.ts`)
   ├─ Serves approved member `businesses` + approved/published `discovered_businesses`
   ├─ Strictly excludes `duplicate`, `rejected`, `confirmed_closed`, and `archived`
   └─ Displays honest `Unverified · Public source` labels and required source attribution links
   ▼
Continuous Monitoring (`worker/src/services/discovery/monitoring.ts`)
   └─ Progressive anti-false-closure state machine (`healthy` -> `watch` -> `potentially_outdated` -> `under_investigation` -> `archived`)
```

---

## 2. Supported Discovery Sources & Licensing Policy

Every source in `discovery_sources` starts with `permission_status = 'pending_review'` and `enabled = 0`. A database `CHECK` constraint prevents enabling any source that is not explicitly `approved`.

| Source ID | Connector | Licence & Attribution | Compliance Notes |
|---|---|---|---|
| `openstreetmap_overpass` | OpenStreetMap Overpass API | **ODbL-1.0** — `© OpenStreetMap contributors` (`https://www.openstreetmap.org/copyright`) | Read-only bounded bounding boxes (≤ 0.2° × 0.2°); never uses the OSM editing API. Legal review is recommended before redistributing mixed ODbL databases (share-alike rules). |
| `official_website_structured` | Public HTTPS JSON-LD (`schema.org/LocalBusiness`) | Business Public Website (`Public Website Structured Metadata`) | SSRF-guarded (`validateSafeExternalFetchUrl`); extracts only explicitly published structured metadata; never bypasses logins/paywalls/CAPTCHAs. |
| `authorised_open_registry` | Partner / Chamber / Open JSON Feeds | Open Government / Partner Licence | Ingests only explicitly authorised JSON endpoints with attribution preserved per record. |

**Strictly prohibited**: Scraping restricted platforms (Google Maps, social media), bypassing authentication/CAPTCHAs, or fabricating missing fields.

---

## 3. Database Schema, Migrations & Rollback

- **Migration 0004** (`worker/migrations/0004_business_discovery.sql`): `discovery_sources`, `discovery_jobs`, `discovered_businesses`, `business_evidence`.
- **Migration 0005** (`worker/migrations/0005_discovery_intelligence_monitoring.sql`): extends `discovery_sources`, `discovered_businesses`, `discovery_jobs`, and `businesses` with provenance/health/lifecycle columns and adds:
  - `business_monitoring`
  - `business_change_history`
  - `bot_review_queue`
  - `discovery_coverage_cells`
  - `discovery_bot_settings`
- **Reversible Rollback SQL**: Stored safely outside `worker/migrations/` at `docs/business-discovery/migrations-rollback.sql` so Wrangler never runs it automatically.

Apply migrations:

```bash
# Local development D1
npm run cf:db:migrate:local

# Remote development D1
npm run cf:db:migrate:dev

# Production D1 (run only during an approved release window)
npm run cf:db:migrate:prod
```

---

## 4. Cloudflare Queues, Cron Triggers & Environment Configuration

Configured in `wrangler.toml`:

- **Development queues**: `naijapages-discovery-dev` + DLQ `naijapages-discovery-dev-dlq`
- **Production queues**: `naijapages-discovery` + DLQ `naijapages-discovery-dlq`
- **Cron trigger**: `0 1 * * *` (01:00 UTC / 02:00 Africa/Lagos)

Create Cloudflare Queue resources before first production enablement (not run automatically):

```bash
npx wrangler queues create naijapages-discovery-dev
npx wrangler queues create naijapages-discovery-dev-dlq
npx wrangler queues create naijapages-discovery
npx wrangler queues create naijapages-discovery-dlq
```

### Environment Variables & Safe Defaults

| Variable | Default | Purpose |
|---|---|---|
| `DISCOVERY_ENABLED` | `"false"` | Master kill-switch for queue execution and scheduling |
| `DISCOVERY_SCHEDULER_ENABLED` | `"false"` | Enables Cron-triggered job creation (requires `DISCOVERY_ENABLED="true"`) |
| `DISCOVERY_DRY_RUN` | `"true"` | Validates job parameters without external HTTP requests |
| `DISCOVERY_MAX_JOBS_PER_RUN` | `"5"` | Max jobs created per cron invocation |
| `DISCOVERY_MAX_ATTEMPTS` | `"3"` | Max retries before routing to Dead-Letter Queue |
| `DISCOVERY_STALE_JOB_TIMEOUT_MS` | `"900000"` | Threshold (15 min) to recover stuck `running` jobs |
| `DISCOVERY_MAX_QUEUED_BACKLOG` | `"100"` | Backlog ceiling to prevent runaway queues |

All secrets (e.g., `BETTER_AUTH_SECRET`, optional provider keys) are configured via `wrangler secret put` and never committed to source control.

---

## 5. Verification, Confidence Scoring & Publishing Rules

1. **Zero Fabrication**: Missing phones, websites, ratings, reviews, hours, or CAC numbers remain `NULL`/`0`.
2. **Honest Verification Tiers**:
   - `discovered` — raw single-source record
   - `evidence_checked` — contact/address checked across evidence
   - `listing_verified` — corroborated across ≥ 2 independent sources with zero conflicts
   - `registry_corroborated` — corroborated with an authorised open registry/partner feed
   - `owner_verified` — **ONLY** granted via member ownership claim + admin verification (`isVerified = true`)
3. **Auto-Publishing Gate**: Requires valid name, category, Nigerian state, location/contact, zero contradictions, zero closure signals, `confidence_score >= autoPublishMinConfidence` (default `0.85`), and `corroborating_source_count >= autoPublishMinSources` (default `2`). Everything else routes to the Admin **Review Queue**.
4. **Branch-Aware Deduplication**: Records sharing a brand name or domain at distinct physical locations (> 350 m apart, different state/LGA, or distinct street addresses) are classified as `distinct_branch` and never merged.

---

## 6. Continuous Monitoring & Anti-False-Closure Policy

1. **First unreachable check**: Transitions to `watch`, keeps the business **published**, and schedules a recheck in 3 days.
2. **Repeated failures**: Transitions to `potentially_outdated` -> `under_investigation` and creates a `bot_review_queue` task.
3. **Relocation detected**: Transitions to `relocated` with suggested action `update_location` — never archived as closed.
4. **Confirmed closure**: Only when corroborated closure signals reach `closureConfirmThreshold` (default `3`) or an administrator explicitly confirms closure. The listing is set to `archived`, immediately hidden from public search, and all historical evidence + `business_change_history` records remain intact for one-click restoration.

---

## 7. Admin Operations Guide (`#/admin/intelligence`)

All endpoints under `/api/v1/admin/discovery/*` require an authenticated Cloudflare D1 `admin` session (`requireAdmin` middleware) and record every decision in both `audit_log` and `business_change_history`.

- **Overview & Coverage**: Monitor total authentic listings, 37-state coverage gaps, and least-covered categories.
- **Review Queue**: Inspect evidence links, confidence scores, and duplicate comparisons; edit fields inline; Approve & Publish, Keep Separate Branch, Merge Duplicate, Reject, Request Verification, Confirm Relocation, Confirm Closure, or Restore Archived.
- **Sources & Jobs**: Approve/enable/disable sources, reset tripped circuit breakers (auto-trips after 3 consecutive failures for 30 minutes), enqueue bounded manual discovery jobs, and retry failed jobs.
- **Monitoring & History**: Review health anomalies, archive confirmed closures, restore archived listings, and audit the immutable change history.
- **Bot Controls**: Toggle Global Pause, Discovery Pause, Monitoring Pause, daily job limits, confidence thresholds, and optional AI budget caps.

---

## 8. Troubleshooting, Emergency Disablement & Cost Control

### Immediately Disable the Bot
1. **Instant UI Switch**: Open `#/admin/intelligence` -> click **Pause All Bot Jobs** (sets `discovery_bot_settings.global_paused = 1` in D1 immediately).
2. **Infrastructure Kill-Switch**: Set `DISCOVERY_ENABLED = "false"` and `DISCOVERY_SCHEDULER_ENABLED = "false"` in `wrangler.toml` and redeploy.

### Recovering Failed or Dead-Lettered Jobs
- Open `#/admin/intelligence` -> **Sources & Jobs** -> locate the `failed` job -> click **Retry** (resets attempt counter and re-enqueues safely).
- If a source's circuit breaker tripped (`circuit_open`), wait for the 30-minute cooldown or click **Reset Circuit** after verifying upstream availability.

### Adding a New Legal Source
1. Implement `DiscoverySourceAdapter` in `worker/src/services/discovery/sources/`.
2. Register the adapter in `worker/src/services/discovery/sources/registry.ts` with `permission_status = 'pending_review'` and `enabled = 0`.
3. Add deterministic fixture unit tests (no live network calls in CI).
4. Review legal licence/attribution terms, then approve and enable the source in `#/admin/intelligence`.

### Estimated Cloudflare Operating Costs
- Designed to run comfortably within the **Cloudflare Workers Paid ($5/month)** tier at early/moderate scale:
  - D1 reads/writes stay minimal due to compact queue messages, cell scan cooldowns (7 days), and tiered monitoring intervals (30–90 days).
  - Queue volume is capped by `DISCOVERY_MAX_JOBS_PER_RUN`, `dailyJobLimit`, and `DISCOVERY_MAX_QUEUED_BACKLOG`.
  - AI extraction is disabled by default (`aiExtractionEnabled = false`, deterministic rules handle structured extraction at zero LLM cost).
