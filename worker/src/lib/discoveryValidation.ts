/**
 * Data integrity and validation helpers for the Phase 1 Business Discovery
 * staging database (`discovery_sources`, `discovery_jobs`,
 * `discovered_businesses`, and `business_evidence`).
 *
 * Principles:
 * - Never fabricate default contact values (unavailable phone/email/website/address
 *   must remain `null`, never placeholder text or invented numbers).
 * - Never populate candidate ratings, review counts, CAC numbers, socials, or
 *   verified badges.
 * - Unapproved sources (`permission_status !== 'approved'`) cannot be enabled
 *   or treated as usable.
 */
import {
  cleanEmail,
  cleanMultiline,
  cleanPhone,
  cleanText,
  NIGERIA_STATES,
  safeHttpUrl,
  ValidationError,
} from './validation';

export const DISCOVERY_LIMITS = {
  id: 120,
  sourceName: 120,
  sourceRecordId: 200,
  sourceRecordType: 60,
  licenceName: 120,
  licenceReference: 200,
  attributionText: 500,
  permittedUsage: 1000,
  url: 600,
  businessName: 160,
  normalizedName: 160,
  category: 80,
  subcategory: 80,
  country: 60,
  state: 40,
  lga: 80,
  city: 100,
  town: 100,
  address: 300,
  phone: 25,
  email: 150,
  openingHours: 240,
  description: 2000,
  identityHash: 128,
  idempotencyKey: 200,
  fieldName: 80,
  evidenceValue: 2000,
  notes: 1000,
  errorMessage: 1000,
  jsonBytes: 65_536,
} as const;

export const DISCOVERY_SOURCE_TYPES = [
  'open_data',
  'public_registry',
  'map_directory',
  'government_portal',
  'partner_api',
  'web_directory',
  'other',
] as const;
export type DiscoverySourceType = (typeof DISCOVERY_SOURCE_TYPES)[number];

export const DISCOVERY_PERMISSION_STATUSES = [
  'pending_review',
  'approved',
  'restricted',
  'rejected',
  'revoked',
] as const;
export type DiscoveryPermissionStatus = (typeof DISCOVERY_PERMISSION_STATUSES)[number];

export const DISCOVERY_JOB_TYPES = [
  'state_sweep',
  'lga_sweep',
  'category_sweep',
  'targeted_lookup',
  'refresh',
  'reverification',
] as const;
export type DiscoveryJobType = (typeof DISCOVERY_JOB_TYPES)[number];

export const DISCOVERY_JOB_STATUSES = [
  'queued',
  'running',
  'completed',
  'partially_completed',
  'failed',
  'cancelled',
] as const;
export type DiscoveryJobStatus = (typeof DISCOVERY_JOB_STATUSES)[number];

export const DISCOVERED_REVIEW_STATUSES = [
  'discovered',
  'needs_review',
  'approved',
  'rejected',
  'duplicate',
  'archived',
] as const;
export type DiscoveredReviewStatus = (typeof DISCOVERED_REVIEW_STATUSES)[number];

export const DISCOVERED_VERIFICATION_STATUSES = [
  'unverified',
  'source_corroborated',
  'owner_pending',
  'owner_verified',
  'disputed',
] as const;
export type DiscoveredVerificationStatus = (typeof DISCOVERED_VERIFICATION_STATUSES)[number];

export const BUSINESS_EVIDENCE_TYPES = [
  'source_record',
  'field_extraction',
  'corroboration',
  'geocode',
  'website_check',
  'registry_match',
  'manual_review',
  'other',
] as const;
export type BusinessEvidenceType = (typeof BUSINESS_EVIDENCE_TYPES)[number];

/** Approximate bounding box covering Nigeria (for optional geographic sanity checks). */
export const NIGERIA_BOUNDS = {
  minLatitude: 4.0,
  maxLatitude: 14.1,
  minLongitude: 2.5,
  maxLongitude: 15.0,
} as const;

const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const CANONICAL_STATE_LOOKUP = new Map<string, (typeof NIGERIA_STATES)[number]>();
for (const state of NIGERIA_STATES) {
  CANONICAL_STATE_LOOKUP.set(state.toLowerCase(), state);
  CANONICAL_STATE_LOOKUP.set(`${state.toLowerCase()} state`, state);
}
CANONICAL_STATE_LOOKUP.set('abuja', 'FCT');
CANONICAL_STATE_LOOKUP.set('fct abuja', 'FCT');
CANONICAL_STATE_LOOKUP.set('abuja fct', 'FCT');
CANONICAL_STATE_LOOKUP.set('federal capital territory', 'FCT');
CANONICAL_STATE_LOOKUP.set('federal capital territory (fct)', 'FCT');

function fail(message: string): never {
  throw new ValidationError(message);
}

/**
 * Normalizes a Nigerian state name to its canonical NaijaPages spelling when present.
 * Returns `null` when unavailable (never invents a state).
 * Throws `ValidationError` if a non-empty value does not match a valid Nigerian state.
 */
export function normalizeNigerianState(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail('State must be a string or null.');
  const trimmed = cleanText(value, DISCOVERY_LIMITS.state + 20);
  if (!trimmed) return null;

  const canonical = CANONICAL_STATE_LOOKUP.get(trimmed.toLowerCase());
  if (!canonical) {
    fail(`Invalid Nigerian state value: "${trimmed}".`);
  }
  return canonical;
}

/**
 * Checks whether a coordinate pair lies inside Nigeria's approximate geographic bounding box.
 */
export function isWithinNigeriaBounds(latitude: number, longitude: number): boolean {
  return (
    latitude >= NIGERIA_BOUNDS.minLatitude &&
    latitude <= NIGERIA_BOUNDS.maxLatitude &&
    longitude >= NIGERIA_BOUNDS.minLongitude &&
    longitude <= NIGERIA_BOUNDS.maxLongitude
  );
}

/**
 * Validates latitude and longitude values.
 * Both may be null/undefined when coordinates are unavailable.
 * Half-specified coordinates or out-of-range WGS84 values are rejected.
 */
export function validateCoordinates(
  latitudeInput: unknown,
  longitudeInput: unknown,
  opts: { requireNigeriaBounds?: boolean } = {},
): { latitude: number | null; longitude: number | null } {
  const latEmpty = latitudeInput === undefined || latitudeInput === null || latitudeInput === '';
  const lngEmpty = longitudeInput === undefined || longitudeInput === null || longitudeInput === '';

  if (latEmpty && lngEmpty) {
    return { latitude: null, longitude: null };
  }
  if (latEmpty !== lngEmpty) {
    fail('Latitude and longitude must either both be provided or both be null.');
  }

  const latitude = typeof latitudeInput === 'number' ? latitudeInput : Number(latitudeInput);
  const longitude = typeof longitudeInput === 'number' ? longitudeInput : Number(longitudeInput);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    fail('Latitude must be a finite number between -90 and 90.');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    fail('Longitude must be a finite number between -180 and 180.');
  }
  if (opts.requireNigeriaBounds && !isWithinNigeriaBounds(latitude, longitude)) {
    fail('Coordinates fall outside Nigeria geographic bounds.');
  }

  return { latitude, longitude };
}

/**
 * Validates a confidence score strictly within [0, 1].
 */
export function validateConfidenceScore(value: unknown, defaultValue = 0): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 1) {
    fail('Confidence score must be a finite number between 0 and 1.');
  }
  return num;
}

/**
 * Validates an integer Unix epoch millisecond timestamp.
 */
export function validateEpochTimestamp(
  value: unknown,
  label: string,
  opts: { required?: boolean } = {},
): number | null {
  if (value === undefined || value === null || value === '') {
    if (opts.required) fail(`${label} timestamp is required.`);
    return null;
  }
  const num = typeof value === 'number' ? value : Number(value);
  // Reject non-integers, negative timestamps, or implausible far-future values (> year 3000).
  const MAX_EPOCH_MS = 32_503_680_000_000;
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0 || num > MAX_EPOCH_MS) {
    fail(`${label} must be a valid non-negative integer Unix epoch millisecond timestamp.`);
  }
  return num;
}

/**
 * Validates a required identifier (such as source_id or source_record_id) without truncating silently.
 */
export function validateRequiredIdentifier(
  value: unknown,
  label: string,
  maxLength: number = DISCOVERY_LIMITS.id,
): string {
  if (typeof value !== 'string') fail(`${label} is required.`);
  const cleaned = cleanText(value, maxLength + 1);
  if (!cleaned) fail(`${label} is required.`);
  if (cleaned.length > maxLength) {
    fail(`${label} exceeds maximum length of ${maxLength} characters.`);
  }
  return cleaned;
}

/**
 * Validates an optional bounded text field. Returns `null` when unavailable.
 */
export function validateOptionalText(
  value: unknown,
  label: string,
  maxLength: number,
  opts: { multiline?: boolean } = {},
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail(`${label} must be a string or null.`);
  const cleaned = opts.multiline
    ? cleanMultiline(value, maxLength + 1)
    : cleanText(value, maxLength + 1);
  if (!cleaned) return null;
  if (cleaned.length > maxLength) {
    fail(`${label} exceeds maximum length of ${maxLength} characters.`);
  }
  return cleaned;
}

/**
 * Validates an HTTP(S) URL for discovery sources, records, licences, or business websites.
 * Returns `null` when optional and absent; never invents a URL.
 */
export function validateDiscoveryUrl(
  value: unknown,
  label: string,
  opts: { required?: boolean; httpsOnly?: boolean; maxLength?: number } = {},
): string | null {
  const maxLength = opts.maxLength ?? DISCOVERY_LIMITS.url;
  if (value === undefined || value === null) {
    if (opts.required) fail(`${label} is required.`);
    return null;
  }
  if (typeof value !== 'string') fail(`${label} must be a valid URL string.`);
  const trimmed = value.trim();
  if (!trimmed) {
    if (opts.required) fail(`${label} is required.`);
    return null;
  }
  if (trimmed.length > maxLength) {
    fail(`${label} exceeds maximum length of ${maxLength} characters.`);
  }
  const parsed = safeHttpUrl(trimmed, { httpsOnly: opts.httpsOnly ?? false, max: maxLength });
  if (!parsed) {
    fail(`${label} must be a valid ${opts.httpsOnly ? 'https://' : 'http(s)://'} URL.`);
  }
  return parsed;
}

function stripForbiddenKeys(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(stripForbiddenKeys);
  }
  if (input && typeof input === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      if (FORBIDDEN_JSON_KEYS.has(key)) continue;
      clean[key] = stripForbiddenKeys(val);
    }
    return clean;
  }
  return input;
}

/**
 * Safely parses a JSON object string (or validates an already-parsed plain object).
 * Rejects invalid JSON, non-object JSON payloads, and payloads exceeding `maxBytes`.
 */
export function safeParseJsonObject(
  raw: unknown,
  opts: { maxBytes?: number; allowInvalidFallback?: boolean } = {},
): Record<string, unknown> {
  const maxBytes = opts.maxBytes ?? DISCOVERY_LIMITS.jsonBytes;

  if (raw === undefined || raw === null || raw === '') {
    return {};
  }

  let parsed: unknown;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    if (trimmed.length > maxBytes) {
      if (opts.allowInvalidFallback) return {};
      fail(`JSON payload exceeds maximum size of ${maxBytes} bytes.`);
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      if (opts.allowInvalidFallback) return {};
      fail('Malformed JSON payload.');
    }
  } else if (typeof raw === 'object' && !Array.isArray(raw)) {
    parsed = raw;
  } else {
    if (opts.allowInvalidFallback) return {};
    fail('Expected a JSON object payload.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    if (opts.allowInvalidFallback) return {};
    fail('JSON payload must be a plain object.');
  }

  const sanitized = stripForbiddenKeys(parsed) as Record<string, unknown>;
  const serialized = JSON.stringify(sanitized);
  if (serialized.length > maxBytes) {
    if (opts.allowInvalidFallback) return {};
    fail(`JSON payload exceeds maximum size of ${maxBytes} bytes.`);
  }
  return sanitized;
}

/**
 * Validates and serializes a plain JSON object payload for D1 `*_json` columns.
 */
export function serializeSafeJsonObject(
  value: unknown,
  opts: { maxBytes?: number } = {},
): string {
  const obj = safeParseJsonObject(value, { maxBytes: opts.maxBytes, allowInvalidFallback: false });
  return JSON.stringify(obj);
}

/**
 * Normalizes a business name for deterministic matching and indexing.
 */
export function normalizeBusinessName(name: string): string {
  return cleanText(name, DISCOVERY_LIMITS.businessName)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DISCOVERY_LIMITS.normalizedName);
}

export function isValidReviewStatus(value: unknown): value is DiscoveredReviewStatus {
  return (
    typeof value === 'string' &&
    (DISCOVERED_REVIEW_STATUSES as readonly string[]).includes(value)
  );
}

export function isValidVerificationStatus(value: unknown): value is DiscoveredVerificationStatus {
  return (
    typeof value === 'string' &&
    (DISCOVERED_VERIFICATION_STATUSES as readonly string[]).includes(value)
  );
}

export function isValidJobStatus(value: unknown): value is DiscoveryJobStatus {
  return (
    typeof value === 'string' &&
    (DISCOVERY_JOB_STATUSES as readonly string[]).includes(value)
  );
}

export function isValidPermissionStatus(value: unknown): value is DiscoveryPermissionStatus {
  return (
    typeof value === 'string' &&
    (DISCOVERY_PERMISSION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Authoritative runtime check: an unapproved source MUST NEVER be treated as usable.
 */
export function isDiscoverySourceUsable(source: {
  permissionStatus: string;
  enabled: boolean | number;
}): boolean {
  return source.permissionStatus === 'approved' && Boolean(source.enabled);
}

export interface ValidatedDiscoverySourceInput {
  id: string;
  name: string;
  sourceType: DiscoverySourceType;
  baseUrl: string;
  description: string | null;
  licenceName: string;
  licenceUrl: string | null;
  attributionText: string | null;
  permittedUsage: string | null;
  permissionStatus: DiscoveryPermissionStatus;
  enabled: boolean;
  rateLimitPerMinute: number;
  lastSuccessfulSync: number | null;
  lastFailedSync: number | null;
  lastError: string | null;
}

export function validateDiscoverySourceInput(
  input: Record<string, unknown>,
): ValidatedDiscoverySourceInput {
  const id = validateRequiredIdentifier(input.id, 'Source id', DISCOVERY_LIMITS.id);
  const name = validateRequiredIdentifier(input.name, 'Source name', DISCOVERY_LIMITS.sourceName);

  const sourceTypeRaw = cleanText(input.sourceType, 40);
  if (!(DISCOVERY_SOURCE_TYPES as readonly string[]).includes(sourceTypeRaw)) {
    fail(`Unsupported discovery source type: "${sourceTypeRaw}".`);
  }

  const baseUrl = validateDiscoveryUrl(input.baseUrl, 'Source base_url', {
    required: true,
    httpsOnly: true,
    maxLength: DISCOVERY_LIMITS.url,
  })!;

  const licenceName = validateRequiredIdentifier(
    input.licenceName,
    'Licence name',
    DISCOVERY_LIMITS.licenceName,
  );
  const licenceUrl = validateDiscoveryUrl(input.licenceUrl, 'Licence URL', {
    required: false,
    httpsOnly: false,
    maxLength: DISCOVERY_LIMITS.url,
  });

  const permissionStatusRaw =
    input.permissionStatus === undefined || input.permissionStatus === null || input.permissionStatus === ''
      ? 'pending_review'
      : cleanText(input.permissionStatus, 40);
  if (!isValidPermissionStatus(permissionStatusRaw)) {
    fail(`Unsupported permission status: "${permissionStatusRaw}".`);
  }

  const enabled = Boolean(input.enabled);
  if (enabled && permissionStatusRaw !== 'approved') {
    fail('A discovery source cannot be enabled until its permission_status is "approved".');
  }

  const rateLimitRaw =
    input.rateLimitPerMinute === undefined || input.rateLimitPerMinute === null
      ? 30
      : Number(input.rateLimitPerMinute);
  if (!Number.isInteger(rateLimitRaw) || rateLimitRaw <= 0 || rateLimitRaw > 10_000) {
    fail('rate_limit_per_minute must be a positive integer between 1 and 10000.');
  }

  return {
    id,
    name,
    sourceType: sourceTypeRaw as DiscoverySourceType,
    baseUrl,
    description: validateOptionalText(input.description, 'Description', DISCOVERY_LIMITS.description, {
      multiline: true,
    }),
    licenceName,
    licenceUrl,
    attributionText: validateOptionalText(
      input.attributionText,
      'Attribution text',
      DISCOVERY_LIMITS.attributionText,
    ),
    permittedUsage: validateOptionalText(
      input.permittedUsage,
      'Permitted usage',
      DISCOVERY_LIMITS.permittedUsage,
      { multiline: true },
    ),
    permissionStatus: permissionStatusRaw,
    enabled,
    rateLimitPerMinute: rateLimitRaw,
    lastSuccessfulSync: validateEpochTimestamp(input.lastSuccessfulSync, 'last_successful_sync'),
    lastFailedSync: validateEpochTimestamp(input.lastFailedSync, 'last_failed_sync'),
    lastError: validateOptionalText(input.lastError, 'last_error', DISCOVERY_LIMITS.errorMessage),
  };
}

export interface ValidatedDiscoveryJobInput {
  id: string;
  sourceId: string;
  jobType: DiscoveryJobType;
  country: string;
  state: string | null;
  lga: string | null;
  town: string | null;
  category: string | null;
  geographicFilterJson: string;
  searchParametersJson: string;
  status: DiscoveryJobStatus;
  priority: number;
  idempotencyKey: string | null;
  attempts: number;
  startedAt: number | null;
  completedAt: number | null;
  errorMessage: string | null;
}

export function validateDiscoveryJobInput(
  input: Record<string, unknown>,
): ValidatedDiscoveryJobInput {
  const id = validateRequiredIdentifier(input.id, 'Job id', DISCOVERY_LIMITS.id);
  const sourceId = validateRequiredIdentifier(input.sourceId, 'source_id', DISCOVERY_LIMITS.id);

  const jobTypeRaw = cleanText(input.jobType, 40);
  if (!(DISCOVERY_JOB_TYPES as readonly string[]).includes(jobTypeRaw)) {
    fail(`Unsupported discovery job type: "${jobTypeRaw}".`);
  }

  const statusRaw =
    input.status === undefined || input.status === null || input.status === ''
      ? 'queued'
      : cleanText(input.status, 40);
  if (!isValidJobStatus(statusRaw)) {
    fail(`Unsupported discovery job status: "${statusRaw}".`);
  }

  const priorityRaw =
    input.priority === undefined || input.priority === null ? 100 : Number(input.priority);
  if (!Number.isInteger(priorityRaw) || priorityRaw < 0 || priorityRaw > 1000) {
    fail('Job priority must be an integer between 0 and 1000.');
  }

  const attemptsRaw =
    input.attempts === undefined || input.attempts === null ? 0 : Number(input.attempts);
  if (!Number.isInteger(attemptsRaw) || attemptsRaw < 0) {
    fail('Job attempts must be a non-negative integer.');
  }

  const country =
    validateOptionalText(input.country, 'Country', DISCOVERY_LIMITS.country) ?? 'Nigeria';
  const state = normalizeNigerianState(input.state);
  const startedAt = validateEpochTimestamp(input.startedAt, 'started_at');
  const completedAt = validateEpochTimestamp(input.completedAt, 'completed_at');
  if (startedAt !== null && completedAt !== null && completedAt < startedAt) {
    fail('completed_at cannot be earlier than started_at.');
  }

  return {
    id,
    sourceId,
    jobType: jobTypeRaw as DiscoveryJobType,
    country,
    state,
    lga: validateOptionalText(input.lga, 'LGA', DISCOVERY_LIMITS.lga),
    town: validateOptionalText(input.town, 'Town', DISCOVERY_LIMITS.town),
    category: validateOptionalText(input.category, 'Category', DISCOVERY_LIMITS.category),
    geographicFilterJson: serializeSafeJsonObject(input.geographicFilter ?? input.geographicFilterJson),
    searchParametersJson: serializeSafeJsonObject(input.searchParameters ?? input.searchParametersJson),
    status: statusRaw,
    priority: priorityRaw,
    idempotencyKey: validateOptionalText(
      input.idempotencyKey,
      'idempotency_key',
      DISCOVERY_LIMITS.idempotencyKey,
    ),
    attempts: attemptsRaw,
    startedAt,
    completedAt,
    errorMessage: validateOptionalText(
      input.errorMessage,
      'error_message',
      DISCOVERY_LIMITS.errorMessage,
    ),
  };
}

export interface ValidatedDiscoveredBusinessInput {
  id: string;
  sourceId: string;
  sourceRecordId: string;
  sourceRecordType: string | null;
  sourceUrl: string | null;
  name: string;
  normalizedName: string;
  category: string | null;
  subcategory: string | null;
  country: string;
  state: string | null;
  lga: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  email: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  openingHours: string | null;
  description: string | null;
  rawSourceDataJson: string;
  normalizedDataJson: string;
  identityHash: string | null;
  confidenceScore: number;
  verificationStatus: DiscoveredVerificationStatus;
  reviewStatus: DiscoveredReviewStatus;
  firstSeenAt: number;
  lastSeenAt: number;
  lastCheckedAt: number | null;
}

export function validateDiscoveredBusinessInput(
  input: Record<string, unknown>,
  opts: { requireNigeriaBounds?: boolean } = {},
): ValidatedDiscoveredBusinessInput {
  const id = validateRequiredIdentifier(input.id, 'Candidate id', DISCOVERY_LIMITS.id);
  const sourceId = validateRequiredIdentifier(input.sourceId, 'source_id', DISCOVERY_LIMITS.id);
  const sourceRecordId = validateRequiredIdentifier(
    input.sourceRecordId,
    'source_record_id',
    DISCOVERY_LIMITS.sourceRecordId,
  );
  const name = validateRequiredIdentifier(
    input.name,
    'Business name',
    DISCOVERY_LIMITS.businessName,
  );
  const normalizedName =
    validateOptionalText(input.normalizedName, 'normalized_name', DISCOVERY_LIMITS.normalizedName) ||
    normalizeBusinessName(name);
  if (!normalizedName) {
    fail('Business name must contain at least one alphanumeric character.');
  }

  const rawPhone = validateOptionalText(input.phone, 'phone', DISCOVERY_LIMITS.phone);
  const phone = rawPhone
    ? (cleanPhone(rawPhone) ?? fail('Phone number is not valid.'))
    : null;

  const rawSecondaryPhone = validateOptionalText(
    input.secondaryPhone,
    'secondary_phone',
    DISCOVERY_LIMITS.phone,
  );
  const secondaryPhone = rawSecondaryPhone
    ? (cleanPhone(rawSecondaryPhone) ?? fail('Secondary phone number is not valid.'))
    : null;

  const rawEmail = validateOptionalText(input.email, 'email', DISCOVERY_LIMITS.email);
  const email = rawEmail ? (cleanEmail(rawEmail) ?? fail('Email address is not valid.')) : null;

  const website = validateDiscoveryUrl(input.website, 'Website', {
    required: false,
    httpsOnly: false,
    maxLength: DISCOVERY_LIMITS.url,
  });

  const sourceUrl = validateDiscoveryUrl(input.sourceUrl, 'Source URL', {
    required: false,
    httpsOnly: false,
    maxLength: DISCOVERY_LIMITS.url,
  });

  const { latitude, longitude } = validateCoordinates(input.latitude, input.longitude, opts);
  const state = normalizeNigerianState(input.state);
  const confidenceScore = validateConfidenceScore(input.confidenceScore, 0);

  const reviewStatusRaw =
    input.reviewStatus === undefined || input.reviewStatus === null || input.reviewStatus === ''
      ? 'discovered'
      : cleanText(input.reviewStatus, 40);
  if (!isValidReviewStatus(reviewStatusRaw)) {
    fail(`Unsupported candidate review_status: "${reviewStatusRaw}".`);
  }

  const verificationStatusRaw =
    input.verificationStatus === undefined ||
    input.verificationStatus === null ||
    input.verificationStatus === ''
      ? 'unverified'
      : cleanText(input.verificationStatus, 40);
  if (!isValidVerificationStatus(verificationStatusRaw)) {
    fail(`Unsupported candidate verification_status: "${verificationStatusRaw}".`);
  }

  const now = Date.now();
  const firstSeenAt =
    validateEpochTimestamp(input.firstSeenAt, 'first_seen_at') ?? now;
  const lastSeenAt =
    validateEpochTimestamp(input.lastSeenAt, 'last_seen_at') ?? firstSeenAt;
  if (lastSeenAt < firstSeenAt) {
    fail('last_seen_at cannot be earlier than first_seen_at.');
  }
  const lastCheckedAt = validateEpochTimestamp(input.lastCheckedAt, 'last_checked_at');

  return {
    id,
    sourceId,
    sourceRecordId,
    sourceRecordType: validateOptionalText(
      input.sourceRecordType,
      'source_record_type',
      DISCOVERY_LIMITS.sourceRecordType,
    ),
    sourceUrl,
    name,
    normalizedName,
    category: validateOptionalText(input.category, 'Category', DISCOVERY_LIMITS.category),
    subcategory: validateOptionalText(
      input.subcategory,
      'Subcategory',
      DISCOVERY_LIMITS.subcategory,
    ),
    country:
      validateOptionalText(input.country, 'Country', DISCOVERY_LIMITS.country) ?? 'Nigeria',
    state,
    lga: validateOptionalText(input.lga, 'LGA', DISCOVERY_LIMITS.lga),
    city: validateOptionalText(input.city, 'City', DISCOVERY_LIMITS.city),
    address: validateOptionalText(input.address, 'Address', DISCOVERY_LIMITS.address),
    phone,
    secondaryPhone,
    email,
    website,
    latitude,
    longitude,
    openingHours: validateOptionalText(
      input.openingHours,
      'Opening hours',
      DISCOVERY_LIMITS.openingHours,
    ),
    description: validateOptionalText(
      input.description,
      'Description',
      DISCOVERY_LIMITS.description,
      { multiline: true },
    ),
    rawSourceDataJson: serializeSafeJsonObject(input.rawSourceData ?? input.rawSourceDataJson),
    normalizedDataJson: serializeSafeJsonObject(input.normalizedData ?? input.normalizedDataJson),
    identityHash: validateOptionalText(
      input.identityHash,
      'identity_hash',
      DISCOVERY_LIMITS.identityHash,
    ),
    confidenceScore,
    verificationStatus: verificationStatusRaw,
    reviewStatus: reviewStatusRaw,
    firstSeenAt,
    lastSeenAt,
    lastCheckedAt,
  };
}

export interface ValidatedBusinessEvidenceInput {
  id: string;
  discoveredBusinessId: string;
  sourceId: string;
  evidenceType: BusinessEvidenceType;
  fieldName: string;
  evidenceValue: string | null;
  sourceUrl: string | null;
  sourceRecordId: string | null;
  sourceTimestamp: number | null;
  collectedAt: number;
  confidence: number;
  licenceReference: string | null;
  attributionText: string | null;
  notes: string | null;
}

export function validateBusinessEvidenceInput(
  input: Record<string, unknown>,
): ValidatedBusinessEvidenceInput {
  const id = validateRequiredIdentifier(input.id, 'Evidence id', DISCOVERY_LIMITS.id);
  const discoveredBusinessId = validateRequiredIdentifier(
    input.discoveredBusinessId,
    'discovered_business_id',
    DISCOVERY_LIMITS.id,
  );
  const sourceId = validateRequiredIdentifier(input.sourceId, 'source_id', DISCOVERY_LIMITS.id);

  const evidenceTypeRaw = cleanText(input.evidenceType, 40);
  if (!(BUSINESS_EVIDENCE_TYPES as readonly string[]).includes(evidenceTypeRaw)) {
    fail(`Unsupported evidence_type: "${evidenceTypeRaw}".`);
  }

  const fieldName = validateRequiredIdentifier(
    input.fieldName,
    'field_name',
    DISCOVERY_LIMITS.fieldName,
  );

  const collectedAt =
    validateEpochTimestamp(input.collectedAt, 'collected_at', { required: false }) ?? Date.now();
  const sourceTimestamp = validateEpochTimestamp(input.sourceTimestamp, 'source_timestamp');
  const confidence = validateConfidenceScore(input.confidence, 0);

  return {
    id,
    discoveredBusinessId,
    sourceId,
    evidenceType: evidenceTypeRaw as BusinessEvidenceType,
    fieldName,
    evidenceValue: validateOptionalText(
      input.evidenceValue,
      'evidence_value',
      DISCOVERY_LIMITS.evidenceValue,
      { multiline: true },
    ),
    sourceUrl: validateDiscoveryUrl(input.sourceUrl, 'Evidence source_url', {
      required: false,
      httpsOnly: false,
      maxLength: DISCOVERY_LIMITS.url,
    }),
    sourceRecordId: validateOptionalText(
      input.sourceRecordId,
      'source_record_id',
      DISCOVERY_LIMITS.sourceRecordId,
    ),
    sourceTimestamp,
    collectedAt,
    confidence,
    licenceReference: validateOptionalText(
      input.licenceReference,
      'licence_reference',
      DISCOVERY_LIMITS.licenceReference,
    ),
    attributionText: validateOptionalText(
      input.attributionText,
      'attribution_text',
      DISCOVERY_LIMITS.attributionText,
    ),
    notes: validateOptionalText(input.notes, 'notes', DISCOVERY_LIMITS.notes, { multiline: true }),
  };
}
