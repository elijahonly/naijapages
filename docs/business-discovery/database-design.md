# NaijaPages Business Discovery — Database Design (Phase 1)

This document defines the Cloudflare D1 (SQLite) and Drizzle ORM database foundation for NaijaPages' nationwide Nigerian business discovery, evidence tracking, and verification pipeline (`worker/migrations/0004_business_discovery.sql` and `worker/src/db/schema.ts`).

---

## 1. Why Discovered Businesses Are Kept Separate From Member Submissions

The existing `businesses` table (`worker/migrations/0001_initial_schema.sql`) models **member-submitted directory listings** and intentionally enforces strict ownership and contact invariants:

- `owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE`
- `phone TEXT NOT NULL`
- `google_map_url TEXT NOT NULL`
- `address TEXT NOT NULL`

An independently discovered Nigerian business from an authorised open dataset, public registry, or partner source often has **no NaijaPages user account**, **no published phone number**, and **no Google Maps URL**.

Inserting discovered records directly into `businesses` would force either:
- Weakening integrity constraints on member submissions, or
- Fabricating fake owner accounts, fake phone numbers, or placeholder URLs.

Both are unacceptable. Instead, Phase 1 introduces a dedicated staging and provenance layer inside the same Cloudflare D1 database (`DB`), preserving every existing table (`user`, `businesses`, `marketplace_items`, `reviews`, `claims`, `favourites`, `reports`, `audit_log`, etc.) completely untouched.

---

## 2. Tables & Purpose

### A. `discovery_sources`
Registry and governance table for every external data source.

- **Key columns**: `id`, `name`, `source_type`, `base_url`, `description`, `licence_name`, `licence_url`, `attribution_text`, `permitted_usage`, `permission_status`, `enabled`, `rate_limit_per_minute`, `last_successful_sync`, `last_failed_sync`, `last_error`, `created_at`, `updated_at`.
- **Licensing & permission governance**:
  - `permission_status` defaults to `'pending_review'` and supports `'pending_review'`, `'approved'`, `'restricted'`, `'rejected'`, and `'revoked'`.
  - `enabled` defaults to `0` (`false`).
  - A database-level `CHECK (enabled = 0 OR permission_status = 'approved')` constraint — mirrored by `validateDiscoverySourceInput()` and `isDiscoverySourceUsable()` in `worker/src/lib/discoveryValidation.ts` — guarantees that an unapproved source can never be enabled or treated as usable.
- **Attribution & legal traceability**: Stores `licence_name`, `licence_url`, `attribution_text`, and `permitted_usage` so downstream connectors, reviewers, and future publication flows always know whether and how data may be displayed.

### B. `discovery_jobs`
Execution and coverage log for every discovery run (state sweeps, LGA sweeps, category sweeps, targeted lookups, refreshes, and reverifications).

- **Key columns**: `id`, `source_id`, `job_type`, `country`, `state`, `lga`, `town`, `category`, `geographic_filter_json`, `search_parameters_json`, `status`, `priority`, `idempotency_key`, `attempts`, `discovered_count`, `accepted_count`, `rejected_count`, `duplicate_count`, `error_count`, `error_message`, `created_at`, `started_at`, `completed_at`, `updated_at`.
- **Supported statuses**: `queued`, `running`, `completed`, `partially_completed`, `failed`, `cancelled`.
- **Idempotency**: A partial unique index `idx_discovery_jobs_idempotency_key ON discovery_jobs (idempotency_key) WHERE idempotency_key IS NOT NULL` prevents accidental duplicate job creation when the same sweep is scheduled or retried.
- **Queue selection**: Indexed by `(status, priority ASC, created_at ASC)` so future workers can deterministically claim the highest-priority queued job in FIFO order.

### C. `discovered_businesses`
Staging table for independently discovered Nigerian business candidates.

- **Key columns**: `id`, `source_id`, `source_record_id`, `source_record_type`, `source_url`, `name`, `normalized_name`, `category`, `subcategory`, `country`, `state`, `lga`, `city`, `address`, `phone`, `secondary_phone`, `email`, `website`, `latitude`, `longitude`, `opening_hours`, `description`, `raw_source_data_json`, `normalized_data_json`, `identity_hash`, `confidence_score`, `verification_status`, `review_status`, `first_seen_at`, `last_seen_at`, `last_checked_at`, `created_at`, `updated_at`.
- **Nullable contact & location fields**: `phone`, `secondary_phone`, `email`, `website`, `address`, `state`, `lga`, `city`, `latitude`, `longitude`, `opening_hours`, and `description` are all nullable. Unavailable data must remain `NULL` — never filled with placeholder numbers or synthetic values.
- **No invented directory metrics**: Discovered candidates intentionally do **not** have `is_verified`, `rating`, `reviews_count`, `cac_number`, or social-profile columns.
- **Coordinate integrity**: `latitude` (`[-90, 90]`) and `longitude` (`[-180, 180]`) are validated in range and must either both be `NULL` or both be present.

### D. `business_evidence`
Append-only evidence ledger recording the exact provenance behind every candidate and field.

- **Key columns**: `id`, `discovered_business_id`, `source_id`, `evidence_type`, `field_name`, `evidence_value`, `source_url`, `source_record_id`, `source_timestamp`, `collected_at`, `confidence`, `licence_reference`, `attribution_text`, `notes`, `created_at`.
- **Append-only history**: Multiple rows may exist for the same `(discovered_business_id, field_name)` across different sources or timestamps. New observations are appended rather than overwriting earlier evidence, enabling corroboration scoring, discrepancy detection, and full auditability.

---

## 3. Data Relationships

```text
discovery_sources (1)
 ├──< discovery_jobs (N)             [source_id -> discovery_sources.id, ON DELETE RESTRICT]
 ├──< discovered_businesses (N)      [source_id -> discovery_sources.id, ON DELETE RESTRICT]
 └──< business_evidence (N)          [source_id -> discovery_sources.id, ON DELETE RESTRICT]

discovered_businesses (1)
 └──< business_evidence (N)          [discovered_business_id -> discovered_businesses.id, ON DELETE CASCADE]
```

- `ON DELETE RESTRICT` on `source_id` prevents deleting a source that still has jobs, candidates, or evidence referencing it, protecting licensing and provenance trails.
- `ON DELETE CASCADE` on `business_evidence.discovered_business_id` ensures removing a candidate cleanly removes its child evidence rows without leaving orphans.

---

## 4. Candidate Lifecycle & Separation of Confidence, Review, and Verification

Three independent dimensions track a candidate's trustworthiness:

1. **`confidence_score` (`REAL`, `0.0` – `1.0`)**: Quantitative data-quality and corroboration score computed from source reliability and independent evidence. High confidence alone does **not** approve or verify a business.
2. **`review_status`** (editorial / pipeline lifecycle):
   - `discovered` — freshly ingested from an approved source; not yet reviewed.
   - `needs_review` — flagged for human inspection (e.g., ambiguous location, partial data, or conflicting evidence).
   - `approved` — passed administrative/editorial quality review and eligible for a future publishing step.
   - `rejected` — invalid, closed, out-of-scope, or failed provenance checks.
   - `duplicate` — matched to an existing candidate or published directory listing.
   - `archived` — superseded or retired from active review.
3. **`verification_status`** (ownership & external corroboration — strictly separate from `is_verified` badges):
   - `unverified` (default for all discovered records)
   - `source_corroborated` (corroborated across multiple independent approved sources)
   - `owner_pending` (an owner has initiated a claim/verification workflow)
   - `owner_verified` (ownership verified through NaijaPages' formal verification process)
   - `disputed` (challenged or flagged for re-check)

No discovered record receives a public "Verified" badge automatically.

---

## 5. How Duplicate Imports Are Prevented

Duplicate prevention operates at three levels:

1. **Job-level idempotency**: `discovery_jobs.idempotency_key` has a unique index (`idx_discovery_jobs_idempotency_key`) so repeated requests for the same sweep parameters do not enqueue duplicate jobs.
2. **Source-record uniqueness**: `discovered_businesses` enforces `UNIQUE (source_id, source_record_id)` via `idx_discovered_businesses_source_record`. Re-ingesting the same external record from the same source updates `last_seen_at` / appends new `business_evidence` rather than creating duplicate candidate rows.
3. **Cross-source identity matching**: `identity_hash` (`idx_discovered_businesses_identity_hash`) and `(normalized_name, state)` (`idx_discovered_businesses_normalized_name_state`) support cross-source deduplication and merging during later normalization phases without losing source-specific evidence rows.

---

## 6. Safe Integration With the Existing Directory (Future Phases)

Phase 1 intentionally makes **no changes** to public directory search, `businesses`, or publishing flows. When future phases introduce controlled publishing, integration will follow these rules:

- **Explicit eligibility gate**: Only candidates with an `approved` source licence permitting publication, `review_status = 'approved'`, and sufficient provenance evidence will be eligible.
- **No synthetic owner accounts**: Rather than fabricating fake `user` rows to satisfy `businesses.owner_id NOT NULL`, future publishing will either introduce a clearly typed nullable/provenance-backed directory representation via a dedicated migration or promote records through an explicit claim/editorial publication schema while keeping `is_verified = 0` until formal owner verification succeeds.
- **Preserved attribution**: Source attribution (`attribution_text`, `licence_reference`) stored in `discovery_sources` and `business_evidence` will travel with any published record to guarantee licence compliance.
- **Member submissions remain authoritative**: Genuine member-submitted `businesses`, `reviews`, `claims`, and `favourites` will never be overwritten by automated discovery runs.
