# NaijaPages Business Discovery — OpenStreetMap (OSM) Source Connector (Phase 3)

This document describes NaijaPages' first authentic external business discovery connector using **OpenStreetMap (OSM)** via an Overpass-compatible endpoint.

> **Important boundary:** Phase 3 stores discovered OSM features strictly as **unverified candidates** in `discovered_businesses` and append-only provenance rows in `business_evidence`. It **never** auto-publishes into the public `businesses` table, never awards verified badges, and never runs nationwide automated scans.

---

## 1. Architecture & How the OSM Connector Works

The discovery connector layer lives under `worker/src/services/discovery/sources/` and isolates source-specific logic behind the generic `DiscoverySourceAdapter` interface (`types.ts`):

- **`types.ts`** — Source-agnostic adapter contract (`validateQuery`, `healthCheck`, `discover`, `classifyError`, `attribution`), normalized candidate shape, and evidence input shape.
- **`osmMapping.ts`** — Pure, unit-tested OSM bounding-box validation, Nigeria geographic guardrails, controlled OSM tag-to-NaijaPages category classification, Nigerian address/contact extraction, and feature normalization (`node`, `way`, `relation`).
- **`osmSource.ts`** — `OsmDiscoverySourceAdapter` (`source_id = 'openstreetmap_overpass'`): builds bounded Overpass QL queries, sends polite `POST` requests with an honest `User-Agent`, enforces timeouts and byte caps, caches responses briefly in `RATE_LIMIT_KV` (15 minutes), and classifies HTTP/network/timeout/JSON errors.
- **`registry.ts`** — Adapter lookup registry (`getDiscoverySourceAdapter`) and canonical `ensureOsmDiscoverySourceRecord` helper (which defaults to `permission_status = 'pending_review'` and `enabled = 0`).
- **`../ingestion.ts`** — Traceable D1 persistence into `discovered_businesses` and append-only `business_evidence`, duplicate detection on `(source_id, source_record_id)`, `last_seen_at` refresh, tag/field diff evidence on changed re-imports, and `discovery_sources` health timestamp updates (`last_successful_sync`, `last_failed_sync`, `last_error`).
- **`../queueConsumer.ts`** — Integrates registered adapters directly into the Phase 2 Cloudflare Queues consumer (`defaultDiscoveryJobHandler`).

### Execution Flow
1. An admin or pilot script creates a bounded `discovery_jobs` row in D1 targeting `source_id = 'openstreetmap_overpass'` with an explicit small Nigeria `bbox` (`south, west, north, east`) inside `geographic_filter_json`.
2. The Phase 2 queue producer enqueues a lightweight message containing only the `jobId` and `correlationId`.
3. `handleDiscoveryQueueBatch` claims the D1 job atomically, verifies `discovery_sources` is `permission_status = 'approved'` and `enabled = 1`, validates the query, runs `osmSourceAdapter.discover(...)`, persists candidates & evidence via `ingestDiscoveredCandidates(...)`, updates `discovery_sources.last_successful_sync`, and records job counters.
4. Any transient or HTTP `429` failure updates `discovery_sources.last_failed_sync` / `last_error` and schedules a jittered retry respecting `Retry-After`. Permanent errors (invalid bbox, forbidden OSM editing API, HTTP 400/403/404, malformed JSON) fail cleanly and route to the dead-letter queue without looping.

---

## 2. Supported OSM Business Categories & Tags

`classifyOsmBusinessTags()` applies a controlled mapping from OSM tags to NaijaPages directory categories while preserving the original OSM tags inside `raw_source_data_json`, `normalized_data_json`, and `business_evidence`:

| OSM Tag Family | Examples | NaijaPages Category |
|---|---|---|
| `shop=*` | `electronics`, `mobile_phone`, `bakery`, `chemist`, `hairdresser`, `car_repair`, `hardware`, `books`, `dry_cleaning`, `supermarket` | `Tech`, `Food`, `Health`, `Beauty`, `Auto`, `Artisans`, `Education`, `Services`, `Finance`, or `Retail` |
| `healthcare=*` | `clinic`, `hospital`, `laboratory`, `pharmacy`, `dentist` | `Health` |
| `amenity=*` | `restaurant`, `cafe`, `hospital`, `pharmacy`, `bank`, `school`, `university`, `fuel`, `car_wash`, `coworking_space`, `post_office`, `marketplace` | `Food`, `Health`, `Finance`, `Education`, `Auto`, `Retail`, `Tech`, `Services` |
| `tourism=*` | `hotel`, `motel`, `guest_house`, `hostel`, `resort`, `museum`, `gallery` | `Hotels`, `Services` |
| `office=*` | `it`, `software`, `financial`, `accountant`, `insurance`, `logistics`, `company` | `Tech`, `Finance`, `Education`, `Health`, `Auto`, `Services` |
| `craft=*` | `bakery`, `photographer`, `printer`, `electronics_repair`, `carpenter`, `tailor` | `Food`, `Services`, `Health`, `Tech`, `Artisans` |
| `leisure=*` | `fitness_centre`, `spa`, `sports_centre`, `resort`, `bowling_alley` | `Beauty`, `Hotels`, `Services` |
| `industrial=*` | `factory`, `warehouse`, `workshop` | `Artisans` |
| Commercial `building=*` | `hotel`, `hospital`, `clinic`, `school`, `supermarket`, `retail`, `commercial`, `office`, `warehouse`, `restaurant` | Mapped to corresponding category |

### Explicit Rejections
- Unnamed features (missing both `name` and `name:en`).
- Residential & generic buildings (`building=yes`, `house`, `residential`, `apartments`, `detached`, `bungalow`, `garage`, `shed`, `construction`, etc.).
- Non-business amenities (`bench`, `waste_basket`, `toilets`, `parking`, `post_box`, `fountain`, `shelter`, `vending_machine`, etc.).
- Features missing valid geometry (`lat`/`lon`, `center`, `bounds`, or `geometry`) or falling outside Nigeria geographic bounds (`lat 4.0..14.1`, `lng 2.5..15.0`).
- Missing optional attributes (`phone`, `website`, `email`, `opening_hours`, `addr:state`, `addr:lga`) remain strictly `null` and are **never** fabricated.

---

## 3. Required Environment Configuration

All OSM settings are non-secret Worker environment variables defined in `wrangler.toml`:

| Variable | Default | Purpose |
|---|---|---|
| `OSM_OVERPASS_URL` | `""` (unset) | Permitted Overpass-compatible `/api/interpreter` endpoint URL. Intentionally empty by default so no public endpoint is called without explicit operator configuration. |
| `OSM_USER_AGENT` | `NaijaPagesDiscovery/1.0 (+https://naijapages.ng)` | Honest identifying `User-Agent` sent on every request. |
| `OSM_REQUEST_TIMEOUT_MS` | `20000` | Request abort timeout in milliseconds (clamped to `1000..30000`). |
| `OSM_MAX_RESPONSE_BYTES` | `5242880` | Maximum response payload size in bytes (5 MiB default, hard-capped at 10 MiB). |

**Hard safety guardrails:**
- The OpenStreetMap editing API (`/api/0.6/*` and `api.openstreetmap.org`) is explicitly blocked (`OSM_EDITING_API_FORBIDDEN`).
- Bounding boxes are capped at `0.5° x 0.5°` (~55 km x 55 km, max `0.25 sq deg`) and must lie inside Nigeria.
- Result count defaults to `100` and is hard-capped at `500` per job.
- Local in-isolate concurrency is capped at `1` concurrent Overpass request, and identical queries are cached in `RATE_LIMIT_KV` for 15 minutes.

---

## 4. How to Run a Small-Area Pilot

### A. Fixture-Only Automated Tests (Default CI)
```bash
npm run cf:test
```
Runs `worker/src/osmDiscovery.test.ts` with local Miniflare D1 and mocked Overpass JSON fixtures. Zero external HTTP traffic is generated.

### B. Optional Opt-In Live Pilot Test (Manual Only)
To test a small neighbourhood box against an authorised Overpass-compatible endpoint:
```bash
OSM_LIVE_TEST=true \
OSM_OVERPASS_URL="https://<your-permitted-overpass-host>/api/interpreter" \
OSM_LIVE_BBOX="6.425,3.415,6.435,3.430" \
npm run cf:test:osm:live
```

### C. Staging a D1 Discovery Pilot Job
1. Ensure the `openstreetmap_overpass` source row exists (`ensureOsmDiscoverySourceRecord`) and explicitly approve & enable it only after legal/licensing sign-off.
2. Create a `discovery_jobs` row with `source_id = 'openstreetmap_overpass'`, `job_type = 'seed'`, `state = 'Lagos'`, `lga = 'Eti-Osa'`, `geographic_filter_json = '{"bbox":{"south":6.42,"west":3.40,"north":6.45,"east":3.45}}'`, and `search_parameters_json = '{"maxResults":50}'`.
3. Enqueue the job via `enqueueDiscoveryJob(db, queue, job.id)` while `DISCOVERY_ENABLED=true` and `DISCOVERY_DRY_RUN=false`.
4. Inspect staged records in `discovered_businesses` and `business_evidence`—they remain `verification_status = 'unverified'` and `review_status = 'needs_review'`.

---

## 5. ODbL Licensing & Share-Alike Implications

OpenStreetMap data is distributed under the **Open Database License (ODbL) 1.0** (`https://www.openstreetmap.org/copyright`).

- **Share-Alike obligation:** Under ODbL, if you publicly distribute or produce a Derivative Database that incorporates OSM data (or mixes OSM-derived records with proprietary records in a non-Collective Database manner), the Derivative Database may itself need to be released under ODbL.
- **Do not blindly mix OSM data into a proprietary directory:** Keeping OSM candidates isolated in `discovered_businesses` with complete per-field `business_evidence` provenance preserves legal auditability and separation from member-submitted `businesses`.
- **Legal review required:** Before exporting, licensing, publishing, or blending OSM-derived fields into NaijaPages' public directory or commercial APIs, conduct a formal legal review of ODbL Derivative vs. Collective Database rules and Substantial vs. Insubstantial Extract thresholds.

---

## 6. Attribution Requirements

Whenever OSM-derived data is stored, displayed, or exported:
- **Required text:** `© OpenStreetMap contributors`
- **Required link:** `https://www.openstreetmap.org/copyright`
- Both values are stored on the canonical `discovery_sources` row (`openstreetmap_overpass`) and stamped on every `business_evidence` row (`attribution_text` and `licence_reference`).

---

## 7. Limitations of OpenStreetMap Data in Nigeria

- **Uneven geographic coverage:** Major commercial hubs (Lagos, Abuja, Port Harcourt, Ibadan, Kano) have substantially denser mapping than rural LGAs.
- **Incomplete contact metadata:** Many mapped businesses have only a name, category tag, and coordinates—phone numbers, websites, emails, LGAs, and opening hours are frequently absent.
- **Staleness & closures:** Volunteer-mapped POIs may have closed, relocated, or changed names since their last OSM edit timestamp.
- **Inconsistent tagging:** Contributors may tag similar businesses under different keys (`shop`, `amenity`, `office`, `building`) or informal address formats.

---

## 8. Why OSM Records Are NOT Verified Listings

An OpenStreetMap element is a **community-contributed geospatial discovery signal**, not authoritative proof of:
- Current business operation or trading status
- Legal registration (CAC status)
- Business ownership or authorised representative identity
- Active telephone/WhatsApp reachability

Therefore:
- Confidence scores for OSM-only candidates are capped at `0.65`.
- Every ingested candidate is stored with `verification_status = 'unverified'` and `review_status = 'needs_review'`.
- Promotion to a verified public listing requires future verification workflows (cross-source corroboration, human review, or owner claim & verification).

---

## 9. Why Public Overpass Is NOT a Nationwide Production Backend

Public community Overpass instances (`overpass-api.de`, etc.) are shared volunteer infrastructure with strict fair-use quotas, slot limits, and IP throttling. Running recurring nationwide sweeps against public Overpass endpoints would:
- Trigger HTTP `429` / `504` failures and IP bans
- Harm community mapping tools that depend on public Overpass
- Violate responsible usage expectations

**Migration path for nationwide Nigerian coverage:**
1. **Regional OSM extracts (Recommended first step at scale):** Download periodic Nigeria `.osm.pbf` extracts from Geofabrik (`https://download.geofabrik.de/africa/nigeria.html`) and process them offline/in batch pipelines into staged discovery imports with zero Overpass query load.
2. **Self-hosted Overpass instance:** Run a dedicated Overpass API instance scoped to the Nigeria extract for interactive LGA-level queries under NaijaPages' full rate-limit control.
3. **Authorised hosted Overpass / geospatial provider:** Use a contracted commercial OSM/Overpass provider with explicit SLA and throughput rights.

---

## 10. Monitoring Source Failures & Health

Every discovery job execution updates D1 state for operational visibility:
- **`discovery_sources.last_successful_sync`** — Epoch ms of the most recent completed batch.
- **`discovery_sources.last_failed_sync`** & **`discovery_sources.last_error`** — Timestamp and sanitized error message of the latest failure (e.g., `HTTP 429`, `OSM_TIMEOUT`, `OSM_ENDPOINT_NOT_CONFIGURED`).
- **`discovery_jobs`** — Tracks `status`, `attempts`, `discovered_count`, `accepted_count`, `rejected_count`, `duplicate_count`, `error_count`, and `last_error`.
- **Dead-letter queue (`naijapages-discovery-dlq` / `-dev`)** — Captures permanent failures and retry-exhausted jobs for inspection without silent loss.

---

## 11. Adding Future Discovery Sources Using the Adapter Interface

To add a new authorised data source (e.g., government open-data registry, partner chamber of commerce feed, or Geofabrik PBF importer):

1. Create `worker/src/services/discovery/sources/<sourceName>Source.ts` implementing `DiscoverySourceAdapter` (`id`, `attribution`, `validateQuery`, `healthCheck`, `discover`, `classifyError`).
2. Keep all source-specific parsing, tag/category mapping, pagination, and HTTP error classification isolated inside that module.
3. Return normalized `NormalizedDiscoveredCandidate` objects with honest `null` fields and append-only `CandidateEvidenceInput` entries.
4. Register the adapter in `worker/src/services/discovery/sources/registry.ts`.
5. Add a canonical `discovery_sources` seed helper defaulting to `permission_status = 'pending_review'` and `enabled = 0`.
6. Write fixture-only unit & Miniflare D1 integration tests—never make live network calls in CI.
