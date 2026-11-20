/**
 * Traceable persistence of normalized discovery candidates and append-only evidence
 * into Cloudflare D1 (`discovered_businesses` and `business_evidence`).
 *
 * Strict guarantees:
 * - Never writes to the member-submitted `businesses` table.
 * - Never auto-approves or awards a verified badge (`verification_status = 'unverified'`,
 *   `review_status = 'needs_review'`).
 * - Prevents duplicates via `(source_id, source_record_id)`.
 * - Updates `last_seen_at` on repeat imports without creating another candidate row.
 * - Preserves all previously collected evidence and appends new diff evidence when tags/fields change.
 */
import { sanitizeDiscoveryErrorMessage } from './errors';
import type {
  NormalizedDiscoveredCandidate,
  SourceAttribution,
} from './sources/types';

export interface IngestCandidatesSummary {
  discoveredCount: number;
  acceptedCount: number;
  duplicateCount: number;
  updatedCount: number;
  evidenceInsertedCount: number;
}

interface ExistingCandidateRow {
  id: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  state: string | null;
  lga: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  secondary_phone: string | null;
  email: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  opening_hours: string | null;
  description: string | null;
  raw_source_data_json: string;
}

function normalizeTagMap(rawJson: string): Record<string, string> {
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const tags =
      parsed && typeof parsed === 'object' && parsed.tags && typeof parsed.tags === 'object'
        ? (parsed.tags as Record<string, unknown>)
        : {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(tags)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function diffTagMaps(
  previous: Record<string, string>,
  next: Record<string, string>,
): Record<string, { before: string | null; after: string | null }> {
  const diff: Record<string, { before: string | null; after: string | null }> = {};
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    const prevVal = previous[key] ?? null;
    const nextVal = next[key] ?? null;
    if (prevVal !== nextVal) {
      diff[key] = { before: prevVal, after: nextVal };
    }
  }
  return diff;
}

export async function recordDiscoverySourceSuccess(
  db: D1Database,
  sourceId: string,
  now: number = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE discovery_sources
       SET last_successful_sync = ?,
           last_error = NULL,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(now, now, sourceId)
    .run();
}

export async function recordDiscoverySourceFailure(
  db: D1Database,
  sourceId: string,
  err: unknown,
  now: number = Date.now(),
): Promise<void> {
  const safeError = sanitizeDiscoveryErrorMessage(err);
  await db
    .prepare(
      `UPDATE discovery_sources
       SET last_failed_sync = ?,
           last_error = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(now, safeError, now, sourceId)
    .run();
}

export async function ingestDiscoveredCandidates(
  db: D1Database,
  params: {
    attribution: SourceAttribution;
    candidates: NormalizedDiscoveredCandidate[];
    retrievedAt: number;
    sourceDataTimestamp?: number | null;
  },
): Promise<IngestCandidatesSummary> {
  const { attribution, candidates, retrievedAt } = params;
  const licenceReference = `${attribution.licenceName} (${attribution.licenceUrl})`;

  let acceptedCount = 0;
  let duplicateCount = 0;
  let updatedCount = 0;
  let evidenceInsertedCount = 0;

  for (const candidate of candidates) {
    const rawJson = JSON.stringify(candidate.rawSourceData);
    const normalizedJson = JSON.stringify(candidate.normalizedData);
    const effectiveSourceTs = candidate.sourceTimestamp ?? params.sourceDataTimestamp ?? null;

    const existing = await db
      .prepare(
        `SELECT id, name, category, subcategory, state, lga, city, address,
                phone, secondary_phone, email, website, latitude, longitude,
                opening_hours, description, raw_source_data_json
         FROM discovered_businesses
         WHERE source_id = ? AND source_record_id = ?`,
      )
      .bind(attribution.sourceId, candidate.sourceRecordId)
      .first<ExistingCandidateRow>();

    if (!existing) {
      const candidateId = `dbiz_${crypto.randomUUID()}`;
      await db
        .prepare(
          `INSERT INTO discovered_businesses (
            id, source_id, source_record_id, source_record_type, source_url,
            name, normalized_name, category, subcategory,
            country, state, lga, city, address,
            phone, secondary_phone, email, website,
            latitude, longitude, opening_hours, description,
            raw_source_data_json, normalized_data_json, identity_hash,
            confidence_score, verification_status, review_status,
            first_seen_at, last_seen_at, last_checked_at, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, 'unverified', 'needs_review',
            ?, ?, ?, ?, ?
          )`,
        )
        .bind(
          candidateId,
          attribution.sourceId,
          candidate.sourceRecordId,
          candidate.sourceRecordType,
          candidate.sourceUrl,
          candidate.name,
          candidate.normalizedName,
          candidate.category,
          candidate.subcategory,
          candidate.country,
          candidate.state,
          candidate.lga,
          candidate.city,
          candidate.address,
          candidate.phone,
          candidate.secondaryPhone,
          candidate.email,
          candidate.website,
          candidate.latitude,
          candidate.longitude,
          candidate.openingHours,
          candidate.description,
          rawJson,
          normalizedJson,
          candidate.identityHash,
          candidate.confidenceScore,
          retrievedAt,
          retrievedAt,
          retrievedAt,
          retrievedAt,
          retrievedAt,
        )
        .run();

      acceptedCount += 1;

      if (candidate.evidence.length > 0) {
        const stmts = candidate.evidence.map((ev) =>
          db
            .prepare(
              `INSERT INTO business_evidence (
                id, discovered_business_id, source_id, evidence_type, field_name,
                evidence_value, source_url, source_record_id, source_timestamp,
                collected_at, confidence, licence_reference, attribution_text,
                notes, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              `bev_${crypto.randomUUID()}`,
              candidateId,
              attribution.sourceId,
              ev.evidenceType,
              ev.fieldName,
              ev.evidenceValue,
              ev.sourceUrl,
              ev.sourceRecordId,
              ev.sourceTimestamp ?? effectiveSourceTs,
              retrievedAt,
              ev.confidence,
              licenceReference,
              attribution.attributionText,
              ev.notes ?? null,
              retrievedAt,
            ),
        );
        await db.batch(stmts);
        evidenceInsertedCount += stmts.length;
      }

      continue;
    }

    // Repeated import of the same (source_id, source_record_id): never create a duplicate row.
    duplicateCount += 1;

    const prevTags = normalizeTagMap(existing.raw_source_data_json);
    const nextTags = normalizeTagMap(rawJson);
    const tagDiff = diffTagMaps(prevTags, nextTags);
    const changedFieldNames: string[] = [];

    const fieldComparisons: Array<[string, string | number | null, string | number | null]> = [
      ['name', existing.name, candidate.name],
      ['category', existing.category, candidate.category],
      ['subcategory', existing.subcategory, candidate.subcategory],
      ['state', existing.state, candidate.state],
      ['lga', existing.lga, candidate.lga],
      ['city', existing.city, candidate.city],
      ['address', existing.address, candidate.address],
      ['phone', existing.phone, candidate.phone],
      ['secondary_phone', existing.secondary_phone, candidate.secondaryPhone],
      ['email', existing.email, candidate.email],
      ['website', existing.website, candidate.website],
      ['latitude', existing.latitude, candidate.latitude],
      ['longitude', existing.longitude, candidate.longitude],
      ['opening_hours', existing.opening_hours, candidate.openingHours],
      ['description', existing.description, candidate.description],
    ];

    for (const [field, before, after] of fieldComparisons) {
      if (before !== after) {
        changedFieldNames.push(field);
      }
    }

    const hasTagChanges = Object.keys(tagDiff).length > 0;
    const hasChanges = hasTagChanges || changedFieldNames.length > 0;

    if (!hasChanges) {
      await db
        .prepare(
          `UPDATE discovered_businesses
           SET last_seen_at = CASE WHEN ? > last_seen_at THEN ? ELSE last_seen_at END,
               last_checked_at = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .bind(retrievedAt, retrievedAt, retrievedAt, retrievedAt, existing.id)
        .run();
      continue;
    }

    updatedCount += 1;
    // Update candidate fields & raw/normalized snapshots without promoting verification/review status.
    await db
      .prepare(
        `UPDATE discovered_businesses
         SET source_record_type = ?,
             source_url = ?,
             name = ?,
             normalized_name = ?,
             category = ?,
             subcategory = ?,
             state = ?,
             lga = ?,
             city = ?,
             address = ?,
             phone = ?,
             secondary_phone = ?,
             email = ?,
             website = ?,
             latitude = ?,
             longitude = ?,
             opening_hours = ?,
             description = ?,
             raw_source_data_json = ?,
             normalized_data_json = ?,
             identity_hash = ?,
             confidence_score = ?,
             last_seen_at = CASE WHEN ? > last_seen_at THEN ? ELSE last_seen_at END,
             last_checked_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        candidate.sourceRecordType,
        candidate.sourceUrl,
        candidate.name,
        candidate.normalizedName,
        candidate.category,
        candidate.subcategory,
        candidate.state,
        candidate.lga,
        candidate.city,
        candidate.address,
        candidate.phone,
        candidate.secondaryPhone,
        candidate.email,
        candidate.website,
        candidate.latitude,
        candidate.longitude,
        candidate.openingHours,
        candidate.description,
        rawJson,
        normalizedJson,
        candidate.identityHash,
        candidate.confidenceScore,
        retrievedAt,
        retrievedAt,
        retrievedAt,
        retrievedAt,
        existing.id,
      )
      .run();

    // Append diff evidence without erasing previously collected evidence.
    const diffStmts: D1PreparedStatement[] = [];
    if (hasTagChanges) {
      diffStmts.push(
        db
          .prepare(
            `INSERT INTO business_evidence (
              id, discovered_business_id, source_id, evidence_type, field_name,
              evidence_value, source_url, source_record_id, source_timestamp,
              collected_at, confidence, licence_reference, attribution_text,
              notes, created_at
            ) VALUES (?, ?, ?, 'source_record', 'osm_tags_diff', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            `bev_${crypto.randomUUID()}`,
            existing.id,
            attribution.sourceId,
            JSON.stringify(tagDiff),
            candidate.sourceUrl,
            candidate.sourceRecordId,
            effectiveSourceTs,
            retrievedAt,
            candidate.confidenceScore,
            licenceReference,
            attribution.attributionText,
            `Detected updated OSM tags (${Object.keys(tagDiff).join(', ')}) on re-import.`,
            retrievedAt,
          ),
      );
    }

    for (const fieldName of changedFieldNames) {
      const nextVal = (() => {
        const entry = fieldComparisons.find(([f]) => f === fieldName);
        return entry?.[2] === null || entry?.[2] === undefined ? null : String(entry[2]);
      })();
      diffStmts.push(
        db
          .prepare(
            `INSERT INTO business_evidence (
              id, discovered_business_id, source_id, evidence_type, field_name,
              evidence_value, source_url, source_record_id, source_timestamp,
              collected_at, confidence, licence_reference, attribution_text,
              notes, created_at
            ) VALUES (?, ?, ?, 'field_extraction', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            `bev_${crypto.randomUUID()}`,
            existing.id,
            attribution.sourceId,
            fieldName,
            nextVal,
            candidate.sourceUrl,
            candidate.sourceRecordId,
            effectiveSourceTs,
            retrievedAt,
            candidate.confidenceScore,
            licenceReference,
            attribution.attributionText,
            `Field "${fieldName}" changed on re-import; previous evidence preserved.`,
            retrievedAt,
          ),
      );
    }

    if (diffStmts.length > 0) {
      await db.batch(diffStmts);
      evidenceInsertedCount += diffStmts.length;
    }
  }

  return {
    discoveredCount: candidates.length,
    acceptedCount,
    duplicateCount,
    updatedCount,
    evidenceInsertedCount,
  };
}
