/**
 * Multi-signal, branch-aware business deduplication engine.
 *
 * Strict integrity rules:
 * - Never merges two branches of the same company merely because their names match.
 * - Never merges businesses based on name similarity alone.
 * - Flags uncertain matches for human review (`possible_duplicate`).
 * - Detects field conflicts (`conflicting_data`) so established records are never
 *   silently overwritten without evidence.
 */
import { normalizeBusinessName } from '../../lib/discoveryValidation';
import { extractCanonicalDomain, normalizeNigerianPhone } from './normalization';

export interface DeduplicationEntity {
  id: string;
  sourceId?: string | null;
  sourceRecordId?: string | null;
  name: string;
  normalizedName?: string | null;
  category?: string | null;
  state?: string | null;
  lga?: string | null;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  secondaryPhone?: string | null;
  website?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  cacNumber?: string | null;
}

export type DuplicateDecision =
  | 'exact_duplicate'
  | 'likely_duplicate'
  | 'possible_duplicate'
  | 'distinct_branch'
  | 'unrelated';

export interface BusinessConflictDetail {
  field: 'phone' | 'address' | 'website' | 'name';
  existingValue: string;
  candidateValue: string;
}

export interface BusinessMatchResult {
  existingId: string;
  decision: DuplicateDecision;
  score: number;
  distanceMeters: number | null;
  nameSimilarity: number;
  matchedSignals: string[];
  conflicts: BusinessConflictDetail[];
  reason: string;
}

export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

const BUSINESS_STOPWORDS = new Set([
  'ltd',
  'limited',
  'nigeria',
  'nig',
  'plc',
  'enterprises',
  'enterprise',
  'ventures',
  'company',
  'co',
  'inc',
  'services',
  'service',
  'global',
  'international',
  'the',
  'and',
  'of',
]);

function significantTokens(name: string): string[] {
  return normalizeBusinessName(name)
    .split(' ')
    .filter((t) => t.length > 1 && !BUSINESS_STOPWORDS.has(t));
}

export function tokenJaccardSimilarity(a: string, b: string): number {
  const ta = new Set(significantTokens(a));
  const tb = new Set(significantTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) {
    if (tb.has(t)) intersection += 1;
  }
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function levenshteinSimilarity(aRaw: string, bRaw: string): number {
  const a = normalizeBusinessName(aRaw);
  const b = normalizeBusinessName(bRaw);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const m = a.length;
  const n = b.length;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;

  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j += 1) prev[j] = curr[j];
  }

  const maxLen = Math.max(m, n);
  return maxLen === 0 ? 1 : Number(((maxLen - prev[n]) / maxLen).toFixed(3));
}

function normalizeAddressComparable(addr?: string | null): string {
  if (!addr) return '';
  return addr
    .toLowerCase()
    .replace(/\b(?:no\.?|plot|suite|block|floor|street|st\.?|road|rd\.?|avenue|ave\.?|close|way|nigeria)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addressSimilarity(a?: string | null, b?: string | null): number {
  const na = normalizeAddressComparable(a);
  const nb = normalizeAddressComparable(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(' ').filter((w) => w.length > 1));
  const tb = new Set(nb.split(' ').filter((w) => w.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

function phoneSet(entity: DeduplicationEntity): Set<string> {
  const out = new Set<string>();
  for (const raw of [entity.phone, entity.secondaryPhone]) {
    const norm = normalizeNigerianPhone(raw);
    if (norm) out.add(norm.e164);
  }
  return out;
}

/**
 * Evaluates whether `candidate` matches an `existing` business record, is a distinct branch
 * of the same company, requires human review, or is unrelated.
 */
export function evaluateBusinessMatch(
  candidate: DeduplicationEntity,
  existing: DeduplicationEntity,
): BusinessMatchResult {
  const matchedSignals: string[] = [];
  const conflicts: BusinessConflictDetail[] = [];

  // 1. Exact external source record match
  if (
    candidate.sourceId &&
    existing.sourceId &&
    candidate.sourceRecordId &&
    existing.sourceRecordId &&
    candidate.sourceId === existing.sourceId &&
    candidate.sourceRecordId === existing.sourceRecordId
  ) {
    return {
      existingId: existing.id,
      decision: 'exact_duplicate',
      score: 1,
      distanceMeters: 0,
      nameSimilarity: 1,
      matchedSignals: ['exact_source_record_id'],
      conflicts: [],
      reason: 'Identical source_id and source_record_id.',
    };
  }

  const candNormName = candidate.normalizedName || normalizeBusinessName(candidate.name);
  const existNormName = existing.normalizedName || normalizeBusinessName(existing.name);
  const jaccard = tokenJaccardSimilarity(candidate.name, existing.name);
  const lev = levenshteinSimilarity(candNormName, existNormName);
  const nameSimilarity = Number(Math.max(jaccard, lev).toFixed(3));
  const exactNameMatch = candNormName.length > 0 && candNormName === existNormName;

  if (exactNameMatch) matchedSignals.push('exact_name');
  else if (nameSimilarity >= 0.78) matchedSignals.push('fuzzy_name');

  // Coordinates & proximity
  let distanceMeters: number | null = null;
  if (
    typeof candidate.latitude === 'number' &&
    typeof candidate.longitude === 'number' &&
    typeof existing.latitude === 'number' &&
    typeof existing.longitude === 'number'
  ) {
    distanceMeters = haversineDistanceMeters(
      candidate.latitude,
      candidate.longitude,
      existing.latitude,
      existing.longitude,
    );
    if (distanceMeters <= 120) matchedSignals.push('geo_very_close');
    else if (distanceMeters <= 400) matchedSignals.push('geo_nearby');
  }

  // Phones
  const candPhones = phoneSet(candidate);
  const existPhones = phoneSet(existing);
  let phoneMatches = false;
  for (const p of candPhones) {
    if (existPhones.has(p)) {
      phoneMatches = true;
      break;
    }
  }
  if (phoneMatches) {
    matchedSignals.push('phone_match');
  } else if (candPhones.size > 0 && existPhones.size > 0) {
    conflicts.push({
      field: 'phone',
      existingValue: Array.from(existPhones)[0],
      candidateValue: Array.from(candPhones)[0],
    });
  }

  // Website domain
  const candDomain = extractCanonicalDomain(candidate.website);
  const existDomain = extractCanonicalDomain(existing.website);
  const domainMatches = Boolean(candDomain && existDomain && candDomain === existDomain);
  if (domainMatches) {
    matchedSignals.push('domain_match');
  } else if (candDomain && existDomain && candDomain !== existDomain) {
    conflicts.push({
      field: 'website',
      existingValue: existDomain,
      candidateValue: candDomain,
    });
  }

  // Registration identifier (CAC RC/BN)
  const candCac = candidate.cacNumber?.trim().toUpperCase().replace(/\s+/g, '') || null;
  const existCac = existing.cacNumber?.trim().toUpperCase().replace(/\s+/g, '') || null;
  const cacMatches = Boolean(candCac && existCac && candCac === existCac);
  if (cacMatches) matchedSignals.push('cac_match');

  // Address & locality checks
  const addrSim = addressSimilarity(candidate.address, existing.address);
  if (addrSim >= 0.6) matchedSignals.push('address_match');
  const differentState = Boolean(
    candidate.state &&
      existing.state &&
      candidate.state.trim().toLowerCase() !== existing.state.trim().toLowerCase(),
  );
  const differentLga = Boolean(
    candidate.lga &&
      existing.lga &&
      candidate.lga.trim().toLowerCase() !== existing.lga.trim().toLowerCase(),
  );
  const distinctAddresses = Boolean(
    candidate.address && existing.address && addrSim < 0.25,
  );
  if (distinctAddresses) {
    conflicts.push({
      field: 'address',
      existingValue: existing.address!,
      candidateValue: candidate.address!,
    });
  }

  // Same category bonus
  const sameCategory = Boolean(
    candidate.category &&
      existing.category &&
      candidate.category.trim().toLowerCase() === existing.category.trim().toLowerCase(),
  );
  if (sameCategory) matchedSignals.push('category_match');

  // -------------------------------------------------------------------------
  // Branch protection rule:
  // Same brand/company name (or shared corporate domain) at clearly different
  // physical locations (> 300m apart, different state/LGA, or distinct street
  // addresses) MUST be treated as a separate branch — NEVER merged!
  // -------------------------------------------------------------------------
  const clearlyDifferentLocation =
    differentState ||
    (differentLga && (distanceMeters === null || distanceMeters > 350)) ||
    (distanceMeters !== null && distanceMeters > 350) ||
    (distinctAddresses && (distanceMeters === null || distanceMeters > 150));

  if ((exactNameMatch || nameSimilarity >= 0.8 || domainMatches || cacMatches) && clearlyDifferentLocation) {
    return {
      existingId: existing.id,
      decision: 'distinct_branch',
      score: 0.45,
      distanceMeters,
      nameSimilarity,
      matchedSignals,
      conflicts,
      reason:
        'Shared brand/company identity at a distinct physical location; preserve as a separate branch instead of merging.',
    };
  }

  // Compute corroborative score (name alone can NEVER exceed 0.40)
  let score = 0;
  if (exactNameMatch) score += 0.35;
  else if (nameSimilarity >= 0.85) score += 0.3;
  else if (nameSimilarity >= 0.72) score += 0.2;

  if (phoneMatches) score += 0.35;
  if (domainMatches) score += 0.25;
  if (cacMatches) score += 0.3;
  if (addrSim >= 0.65) score += 0.25;
  if (distanceMeters !== null && distanceMeters <= 120) score += 0.25;
  else if (distanceMeters !== null && distanceMeters <= 350) score += 0.15;
  if (sameCategory) score += 0.05;

  // Penalize phone conflict when location matches so conflicting records go to human review
  const hasPhoneConflict = conflicts.some((c) => c.field === 'phone');
  if (hasPhoneConflict) score -= 0.15;

  const clampedScore = Math.max(0, Math.min(1, Number(score.toFixed(3))));

  // Strong corroborative signals (never name-only!)
  const nonNameSignals = matchedSignals.filter(
    (s) => s !== 'exact_name' && s !== 'fuzzy_name' && s !== 'category_match',
  );

  // If business renamed at the same phone + exact location
  if (
    !exactNameMatch &&
    nameSimilarity < 0.72 &&
    ((phoneMatches && (addrSim >= 0.6 || (distanceMeters !== null && distanceMeters <= 120))) ||
      (domainMatches && distanceMeters !== null && distanceMeters <= 120))
  ) {
    conflicts.push({
      field: 'name',
      existingValue: existing.name,
      candidateValue: candidate.name,
    });
    return {
      existingId: existing.id,
      decision: 'possible_duplicate',
      score: Math.max(clampedScore, 0.65),
      distanceMeters,
      nameSimilarity,
      matchedSignals,
      conflicts,
      reason: 'Same location and contact signals with a different business name (possible rename); escalate to review.',
    };
  }

  if (nonNameSignals.length === 0) {
    // NEVER merge based on name similarity alone!
    if (nameSimilarity >= 0.85 && !differentState && !differentLga) {
      return {
        existingId: existing.id,
        decision: 'possible_duplicate',
        score: Math.min(clampedScore, 0.45),
        distanceMeters,
        nameSimilarity,
        matchedSignals,
        conflicts,
        reason: 'Similar business name in the same locality without corroborating phone/address/coordinates; human review required.',
      };
    }
    return {
      existingId: existing.id,
      decision: 'unrelated',
      score: clampedScore,
      distanceMeters,
      nameSimilarity,
      matchedSignals,
      conflicts,
      reason: 'Insufficient corroborating signals beyond name similarity.',
    };
  }

  // High-confidence duplicate with zero phone conflict
  if (clampedScore >= 0.82 && !hasPhoneConflict && (exactNameMatch || nameSimilarity >= 0.78)) {
    return {
      existingId: existing.id,
      decision: 'likely_duplicate',
      score: clampedScore,
      distanceMeters,
      nameSimilarity,
      matchedSignals,
      conflicts,
      reason: `Strong multi-signal match (${matchedSignals.join(', ')}).`,
    };
  }

  // Uncertain or conflicting match -> human review
  if (clampedScore >= 0.52 || (hasPhoneConflict && nonNameSignals.length >= 1 && nameSimilarity >= 0.7)) {
    return {
      existingId: existing.id,
      decision: 'possible_duplicate',
      score: clampedScore,
      distanceMeters,
      nameSimilarity,
      matchedSignals,
      conflicts,
      reason: hasPhoneConflict
        ? 'Location/name match with conflicting telephone number; flagged for admin review.'
        : `Partial multi-signal overlap (${matchedSignals.join(', ')}); requires human review.`,
    };
  }

  return {
    existingId: existing.id,
    decision: 'unrelated',
    score: clampedScore,
    distanceMeters,
    nameSimilarity,
    matchedSignals,
    conflicts,
    reason: 'Match score below deduplication review threshold.',
  };
}

export function findBestBusinessMatches(
  candidate: DeduplicationEntity,
  existingList: DeduplicationEntity[],
  limit = 5,
): BusinessMatchResult[] {
  return existingList
    .filter((ex) => ex.id !== candidate.id)
    .map((ex) => evaluateBusinessMatch(candidate, ex))
    .filter((m) => m.decision !== 'unrelated')
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
