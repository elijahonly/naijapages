/**
 * Pure OpenStreetMap (OSM) tag classification, Nigerian location & contact extraction,
 * bounding-box validation, and feature normalization.
 *
 * Strict data-integrity principles:
 * - Never invent missing fields (phone, website, email, address, state, LGA stay `null`).
 * - Never classify unnamed or residential-only buildings as businesses.
 * - Never award ratings, review counts, CAC numbers, or verified badges.
 * - Always preserve original OSM tags so every category decision is auditable.
 */
import {
  DISCOVERY_LIMITS,
  isWithinNigeriaBounds,
  normalizeBusinessName,
  normalizeNigerianState,
  validateCoordinates,
  validateDiscoveryUrl,
} from '../../../lib/discoveryValidation';
import { cleanEmail, cleanPhone, cleanText, ValidationError } from '../../../lib/validation';
import { DiscoveryJobError } from '../errors';
import type {
  BoundingBox,
  CandidateEvidenceInput,
  DiscoveryQueryRequest,
  NormalizedDiscoveredCandidate,
} from './types';

/** Conservative pilot limits preventing nationwide or unbounded Overpass queries. */
export const OSM_PILOT_LIMITS = {
  maxLatSpanDegrees: 0.5, // ~55 km
  maxLngSpanDegrees: 0.5, // ~55 km
  maxAreaSquareDegrees: 0.25,
  defaultMaxResults: 100,
  maxResultsHardCap: 500,
} as const;

export interface OsmRawElement {
  type: string;
  id: number | string;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  bounds?: { minlat?: number; minlon?: number; maxlat?: number; maxlon?: number };
  geometry?: Array<{ lat?: number; lon?: number }>;
  timestamp?: string;
  version?: number;
  changeset?: number;
  tags?: Record<string, unknown>;
}

export interface OsmClassification {
  category: string;
  subcategory: string;
  matchedTagKey: string;
  matchedTagValue: string;
}

const EXCLUDED_AMENITIES = new Set([
  'bench',
  'waste_basket',
  'waste_disposal',
  'recycling',
  'toilets',
  'drinking_water',
  'fountain',
  'shelter',
  'post_box',
  'telephone',
  'parking',
  'parking_space',
  'parking_entrance',
  'bicycle_parking',
  'motorcycle_parking',
  'grave_yard',
  'clock',
  'watering_place',
  'hunting_stand',
  'vending_machine',
  'bbq',
  'grit_bin',
  'give_box',
  'public_bookcase',
  'lounger',
  'photo_booth',
]);

const RESIDENTIAL_OR_NON_BUSINESS_BUILDINGS = new Set([
  'yes',
  'house',
  'residential',
  'apartments',
  'detached',
  'semidetached_house',
  'terrace',
  'dormitory',
  'bungalow',
  'cabin',
  'hut',
  'shed',
  'garage',
  'garages',
  'roof',
  'ruins',
  'wall',
  'farm_auxiliary',
  'greenhouse',
  'barn',
  'bridge',
  'bunker',
  'carport',
  'construction',
  'static_caravan',
  'tent',
  'toilets',
  'transformer_tower',
  'water_tower',
]);

const COMMERCIAL_BUILDING_CATEGORY_MAP: Record<string, string> = {
  hotel: 'Hotels',
  hospital: 'Health',
  clinic: 'Health',
  school: 'Education',
  college: 'Education',
  university: 'Education',
  kindergarten: 'Education',
  supermarket: 'Retail',
  retail: 'Retail',
  kiosk: 'Retail',
  commercial: 'Services',
  office: 'Services',
  industrial: 'Artisans',
  warehouse: 'Services',
  service: 'Services',
  bakehouse: 'Food',
  restaurant: 'Food',
};

const AMENITY_CATEGORY_MAP: Record<string, string> = {
  restaurant: 'Food',
  fast_food: 'Food',
  cafe: 'Food',
  bar: 'Food',
  pub: 'Food',
  food_court: 'Food',
  ice_cream: 'Food',
  biergarten: 'Food',
  hospital: 'Health',
  clinic: 'Health',
  doctors: 'Health',
  dentist: 'Health',
  pharmacy: 'Health',
  veterinary: 'Health',
  nursing_home: 'Health',
  bank: 'Finance',
  bureau_de_change: 'Finance',
  microfinance: 'Finance',
  payment_centre: 'Finance',
  money_transfer: 'Finance',
  school: 'Education',
  college: 'Education',
  university: 'Education',
  kindergarten: 'Education',
  language_school: 'Education',
  driving_school: 'Education',
  music_school: 'Education',
  training: 'Education',
  library: 'Education',
  fuel: 'Auto',
  car_wash: 'Auto',
  car_rental: 'Auto',
  bus_station: 'Auto',
  taxi: 'Auto',
  ferry_terminal: 'Auto',
  vehicle_inspection: 'Auto',
  marketplace: 'Retail',
  internet_cafe: 'Tech',
  coworking_space: 'Tech',
  cinema: 'Services',
  theatre: 'Services',
  nightclub: 'Services',
  events_venue: 'Services',
  conference_centre: 'Services',
  studio: 'Services',
  post_office: 'Services',
  courier: 'Services',
  courthouse: 'Services',
  townhall: 'Services',
  police: 'Services',
  fire_station: 'Services',
  community_centre: 'Services',
  social_facility: 'Services',
};

const SHOP_CATEGORY_MAP: Record<string, string> = {
  // Tech
  electronics: 'Tech',
  computer: 'Tech',
  mobile_phone: 'Tech',
  telecommunication: 'Tech',
  hifi: 'Tech',
  camera: 'Tech',
  video_games: 'Tech',
  // Food & groceries
  bakery: 'Food',
  butcher: 'Food',
  seafood: 'Food',
  greengrocer: 'Food',
  confectionery: 'Food',
  pastry: 'Food',
  beverages: 'Food',
  alcohol: 'Food',
  coffee: 'Food',
  tea: 'Food',
  spices: 'Food',
  frozen_food: 'Food',
  // Health
  chemist: 'Health',
  optician: 'Health',
  medical_supply: 'Health',
  hearing_aids: 'Health',
  herbalist: 'Health',
  // Beauty
  beauty: 'Beauty',
  hairdresser: 'Beauty',
  hairdresser_supply: 'Beauty',
  cosmetics: 'Beauty',
  perfumery: 'Beauty',
  massage: 'Beauty',
  tattoo: 'Beauty',
  // Auto
  car: 'Auto',
  car_repair: 'Auto',
  car_parts: 'Auto',
  tyres: 'Auto',
  motorcycle: 'Auto',
  motorcycle_repair: 'Auto',
  bicycle: 'Auto',
  // Artisans / Trade
  hardware: 'Artisans',
  doityourself: 'Artisans',
  paint: 'Artisans',
  electrical: 'Artisans',
  tailor: 'Artisans',
  shoe_repair: 'Artisans',
  locksmith: 'Artisans',
  carpenter: 'Artisans',
  glaziery: 'Artisans',
  // Education
  books: 'Education',
  stationery: 'Education',
  // Services
  dry_cleaning: 'Services',
  laundry: 'Services',
  travel_agency: 'Services',
  copyshop: 'Services',
  printshop: 'Services',
  funeral_directors: 'Services',
  estate_agent: 'Services',
  // Finance
  pawnbroker: 'Finance',
  money_lender: 'Finance',
};

const OFFICE_CATEGORY_MAP: Record<string, string> = {
  it: 'Tech',
  telecommunication: 'Tech',
  software: 'Tech',
  financial: 'Finance',
  accountant: 'Finance',
  insurance: 'Finance',
  tax_advisor: 'Finance',
  financial_advisor: 'Finance',
  educational_institution: 'Education',
  research: 'Education',
  physician: 'Health',
  therapist: 'Health',
  logistics: 'Auto',
  transport: 'Auto',
  moving_company: 'Auto',
};

const TOURISM_CATEGORY_MAP: Record<string, string> = {
  hotel: 'Hotels',
  motel: 'Hotels',
  guest_house: 'Hotels',
  hostel: 'Hotels',
  apartment: 'Hotels',
  chalet: 'Hotels',
  resort: 'Hotels',
  museum: 'Services',
  gallery: 'Services',
  theme_park: 'Services',
  zoo: 'Services',
  aquarium: 'Services',
  attraction: 'Services',
};

const LEISURE_CATEGORY_MAP: Record<string, string> = {
  fitness_centre: 'Beauty',
  sports_centre: 'Services',
  stadium: 'Services',
  swimming_pool: 'Services',
  bowling_alley: 'Services',
  amusement_arcade: 'Services',
  water_park: 'Services',
  resort: 'Hotels',
  spa: 'Beauty',
  dance: 'Services',
};

const CRAFT_CATEGORY_MAP: Record<string, string> = {
  bakery: 'Food',
  confectionery: 'Food',
  caterer: 'Food',
  brewery: 'Food',
  photographer: 'Services',
  printer: 'Services',
  optician: 'Health',
  electronics_repair: 'Tech',
  computer: 'Tech',
};

/**
 * Validates an explicit bounding box for a small-area Nigeria OSM discovery pilot.
 * Rejects missing, inverted, out-of-Nigeria, or excessively large bounding boxes.
 */
export function validateOsmBoundingBox(raw: Partial<BoundingBox> | undefined | null): BoundingBox {
  if (!raw || typeof raw !== 'object') {
    throw new DiscoveryJobError('A geographic bounding box (south, west, north, east) is required.', {
      kind: 'permanent',
      code: 'INVALID_BBOX',
    });
  }

  const south = Number(raw.south);
  const west = Number(raw.west);
  const north = Number(raw.north);
  const east = Number(raw.east);

  if (
    !Number.isFinite(south) ||
    !Number.isFinite(west) ||
    !Number.isFinite(north) ||
    !Number.isFinite(east)
  ) {
    throw new DiscoveryJobError('Bounding box coordinates must be finite numbers.', {
      kind: 'permanent',
      code: 'INVALID_BBOX',
    });
  }

  if (south < -90 || north > 90 || west < -180 || east > 180) {
    throw new DiscoveryJobError('Bounding box coordinates are outside valid WGS84 ranges.', {
      kind: 'permanent',
      code: 'INVALID_BBOX',
    });
  }

  if (south >= north || west >= east) {
    throw new DiscoveryJobError('Bounding box must satisfy south < north and west < east.', {
      kind: 'permanent',
      code: 'INVALID_BBOX',
    });
  }

  if (!isWithinNigeriaBounds(south, west) || !isWithinNigeriaBounds(north, east)) {
    throw new DiscoveryJobError(
      'Bounding box must lie within Nigeria geographic bounds (lat 4.0..14.1, lng 2.5..15.0).',
      {
        kind: 'permanent',
        code: 'BBOX_OUTSIDE_NIGERIA',
      },
    );
  }

  const latSpan = north - south;
  const lngSpan = east - west;
  const area = latSpan * lngSpan;

  if (
    latSpan > OSM_PILOT_LIMITS.maxLatSpanDegrees ||
    lngSpan > OSM_PILOT_LIMITS.maxLngSpanDegrees ||
    area > OSM_PILOT_LIMITS.maxAreaSquareDegrees
  ) {
    throw new DiscoveryJobError(
      `Bounding box is too large for an Overpass pilot query (max ${OSM_PILOT_LIMITS.maxLatSpanDegrees}° x ${OSM_PILOT_LIMITS.maxLngSpanDegrees}°). Split into smaller LGA/ward boxes.`,
      {
        kind: 'permanent',
        code: 'BBOX_TOO_LARGE',
      },
    );
  }

  return { south, west, north, east };
}

export function validateOsmQueryRequest(raw: Partial<DiscoveryQueryRequest>): DiscoveryQueryRequest {
  const bbox = validateOsmBoundingBox(raw.bbox);
  const country = cleanText(raw.country ?? 'Nigeria', DISCOVERY_LIMITS.country) || 'Nigeria';
  if (country.toLowerCase() !== 'nigeria') {
    throw new DiscoveryJobError('Only Nigeria discovery queries are permitted in this phase.', {
      kind: 'permanent',
      code: 'UNSUPPORTED_COUNTRY',
    });
  }

  let state: string | null = null;
  try {
    state = normalizeNigerianState(raw.state ?? null);
  } catch (err) {
    throw new DiscoveryJobError(
      err instanceof Error ? err.message : 'Invalid Nigerian state filter.',
      {
        kind: 'permanent',
        code: 'INVALID_STATE',
        cause: err,
      },
    );
  }

  const lga = cleanText(raw.lga ?? '', DISCOVERY_LIMITS.lga) || null;
  const category = cleanText(raw.category ?? '', DISCOVERY_LIMITS.category) || null;

  const rawMax = raw.maxResults ?? OSM_PILOT_LIMITS.defaultMaxResults;
  const maxResults = Math.trunc(Number(rawMax));
  if (!Number.isFinite(maxResults) || maxResults < 1 || maxResults > OSM_PILOT_LIMITS.maxResultsHardCap) {
    throw new DiscoveryJobError(
      `maxResults must be an integer between 1 and ${OSM_PILOT_LIMITS.maxResultsHardCap}.`,
      {
        kind: 'permanent',
        code: 'INVALID_MAX_RESULTS',
      },
    );
  }

  let endpointUrl: string | null = null;
  if (raw.endpointUrl) {
    try {
      endpointUrl = validateDiscoveryUrl(raw.endpointUrl, 'endpointUrl', {
        required: true,
        httpsOnly: false,
      });
    } catch (err) {
      throw new DiscoveryJobError(
        err instanceof Error ? err.message : 'Invalid OSM Overpass endpoint URL.',
        {
          kind: 'permanent',
          code: 'INVALID_ENDPOINT_URL',
          cause: err,
        },
      );
    }
  }

  return {
    country: 'Nigeria',
    state,
    lga,
    category,
    bbox,
    maxResults,
    endpointUrl,
  };
}

function cleanTagString(tags: Record<string, unknown>, key: string, maxLen = 200): string | null {
  const val = tags[key];
  if (typeof val !== 'string') return null;
  const cleaned = cleanText(val, maxLen);
  return cleaned || null;
}

/**
 * Classifies OSM tags into a controlled NaijaPages category & subcategory.
 * Returns `null` when tags do not provide credible evidence of a business,
 * service provider, institution, or public-facing establishment.
 */
export function classifyOsmBusinessTags(tags: Record<string, unknown>): OsmClassification | null {
  const shop = cleanTagString(tags, 'shop', 60)?.toLowerCase();
  if (shop && shop !== 'no' && shop !== 'vacant' && shop !== 'empty') {
    return {
      category: SHOP_CATEGORY_MAP[shop] ?? 'Retail',
      subcategory: `shop:${shop}`,
      matchedTagKey: 'shop',
      matchedTagValue: shop,
    };
  }

  const healthcare = cleanTagString(tags, 'healthcare', 60)?.toLowerCase();
  if (healthcare && healthcare !== 'no') {
    return {
      category: 'Health',
      subcategory: `healthcare:${healthcare}`,
      matchedTagKey: 'healthcare',
      matchedTagValue: healthcare,
    };
  }

  const amenity = cleanTagString(tags, 'amenity', 60)?.toLowerCase();
  if (amenity && amenity !== 'no' && !EXCLUDED_AMENITIES.has(amenity)) {
    const mapped = AMENITY_CATEGORY_MAP[amenity];
    if (mapped) {
      return {
        category: mapped,
        subcategory: `amenity:${amenity}`,
        matchedTagKey: 'amenity',
        matchedTagValue: amenity,
      };
    }
  }

  const tourism = cleanTagString(tags, 'tourism', 60)?.toLowerCase();
  if (tourism && TOURISM_CATEGORY_MAP[tourism]) {
    return {
      category: TOURISM_CATEGORY_MAP[tourism],
      subcategory: `tourism:${tourism}`,
      matchedTagKey: 'tourism',
      matchedTagValue: tourism,
    };
  }

  const office = cleanTagString(tags, 'office', 60)?.toLowerCase();
  if (office && office !== 'no' && office !== 'vacant') {
    return {
      category: OFFICE_CATEGORY_MAP[office] ?? 'Services',
      subcategory: `office:${office}`,
      matchedTagKey: 'office',
      matchedTagValue: office,
    };
  }

  const craft = cleanTagString(tags, 'craft', 60)?.toLowerCase();
  if (craft && craft !== 'no') {
    return {
      category: CRAFT_CATEGORY_MAP[craft] ?? 'Artisans',
      subcategory: `craft:${craft}`,
      matchedTagKey: 'craft',
      matchedTagValue: craft,
    };
  }

  const leisure = cleanTagString(tags, 'leisure', 60)?.toLowerCase();
  if (leisure && LEISURE_CATEGORY_MAP[leisure]) {
    return {
      category: LEISURE_CATEGORY_MAP[leisure],
      subcategory: `leisure:${leisure}`,
      matchedTagKey: 'leisure',
      matchedTagValue: leisure,
    };
  }

  const industrial = cleanTagString(tags, 'industrial', 60)?.toLowerCase();
  if (industrial && industrial !== 'no') {
    return {
      category: 'Artisans',
      subcategory: `industrial:${industrial}`,
      matchedTagKey: 'industrial',
      matchedTagValue: industrial,
    };
  }

  // Only accept `building=*` when it explicitly names a commercial/institutional building type
  // (never `building=yes`, `house`, `residential`, `apartments`, etc.).
  const building = cleanTagString(tags, 'building', 60)?.toLowerCase();
  if (
    building &&
    !RESIDENTIAL_OR_NON_BUSINESS_BUILDINGS.has(building) &&
    COMMERCIAL_BUILDING_CATEGORY_MAP[building]
  ) {
    return {
      category: COMMERCIAL_BUILDING_CATEGORY_MAP[building],
      subcategory: `building:${building}`,
      matchedTagKey: 'building',
      matchedTagValue: building,
    };
  }

  return null;
}

function extractPhones(tags: Record<string, unknown>): {
  phone: string | null;
  secondaryPhone: string | null;
} {
  const candidates: string[] = [];
  for (const key of ['phone', 'contact:phone', 'mobile', 'contact:mobile']) {
    const raw = cleanTagString(tags, key, 120);
    if (!raw) continue;
    for (const part of raw.split(/[;,/]/)) {
      const cleaned = cleanPhone(part.trim());
      if (cleaned && !candidates.includes(cleaned)) {
        candidates.push(cleaned);
      }
    }
  }
  return {
    phone: candidates[0] ?? null,
    secondaryPhone: candidates[1] ?? null,
  };
}

function extractWebsite(tags: Record<string, unknown>): string | null {
  for (const key of ['website', 'contact:website', 'url']) {
    const raw = cleanTagString(tags, key, DISCOVERY_LIMITS.url);
    if (!raw) continue;
    try {
      const validated = validateDiscoveryUrl(raw, 'website', {
        required: false,
        httpsOnly: false,
        maxLength: DISCOVERY_LIMITS.url,
      });
      if (validated) return validated;
    } catch {
      // Ignore malformed website tag instead of inventing or crashing whole batch.
    }
  }
  return null;
}

function extractEmail(tags: Record<string, unknown>): string | null {
  for (const key of ['email', 'contact:email']) {
    const raw = cleanTagString(tags, key, DISCOVERY_LIMITS.email);
    if (!raw) continue;
    const cleaned = cleanEmail(raw);
    if (cleaned) return cleaned;
  }
  return null;
}

function extractCoordinates(
  el: OsmRawElement,
): { latitude: number; longitude: number } | { error: string } {
  let lat: unknown;
  let lon: unknown;

  if (el.type === 'node') {
    lat = el.lat;
    lon = el.lon;
  } else if (el.center && el.center.lat !== undefined && el.center.lon !== undefined) {
    lat = el.center.lat;
    lon = el.center.lon;
  } else if (
    el.bounds &&
    el.bounds.minlat !== undefined &&
    el.bounds.maxlat !== undefined &&
    el.bounds.minlon !== undefined &&
    el.bounds.maxlon !== undefined
  ) {
    lat = (Number(el.bounds.minlat) + Number(el.bounds.maxlat)) / 2;
    lon = (Number(el.bounds.minlon) + Number(el.bounds.maxlon)) / 2;
  } else if (Array.isArray(el.geometry) && el.geometry.length > 0) {
    const validPts = el.geometry.filter(
      (p) => typeof p?.lat === 'number' && typeof p?.lon === 'number',
    );
    if (validPts.length > 0) {
      lat = validPts.reduce((acc, p) => acc + Number(p.lat), 0) / validPts.length;
      lon = validPts.reduce((acc, p) => acc + Number(p.lon), 0) / validPts.length;
    }
  }

  if (lat === undefined || lon === undefined) {
    return { error: 'missing_geometry' };
  }

  try {
    const coords = validateCoordinates(lat, lon, { requireNigeriaBounds: true });
    if (coords.latitude === null || coords.longitude === null) {
      return { error: 'missing_geometry' };
    }
    return { latitude: coords.latitude, longitude: coords.longitude };
  } catch (err) {
    if (err instanceof ValidationError) {
      return { error: 'invalid_coordinates' };
    }
    return { error: 'invalid_coordinates' };
  }
}

function computeIdentityHashSync(parts: Array<string | number | null | undefined>): string {
  const input = parts
    .map((p) => (p === null || p === undefined ? '' : String(p).trim().toLowerCase()))
    .join('|');
  // Deterministic 64-bit FNV-1a dual-lane hex digest (fast, synchronous, zero dependencies).
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return `osm_id_${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

function parseOsmTimestamp(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) && ms >= 0 ? Math.trunc(ms) : null;
}

/**
 * Normalizes a single raw Overpass/OSM element into a staged `NormalizedDiscoveredCandidate`.
 * Returns `{ ok: false, reason }` when the element lacks credible business evidence,
 * a name, supported element type, or valid Nigerian coordinates.
 */
export function normalizeOsmElement(
  element: OsmRawElement,
  context: {
    country?: string;
    stateHint?: string | null;
    lgaHint?: string | null;
    categoryFilter?: string | null;
  } = {},
): { ok: true; candidate: NormalizedDiscoveredCandidate } | { ok: false; reason: string } {
  if (!element || typeof element !== 'object') {
    return { ok: false, reason: 'malformed_element' };
  }

  const elType = typeof element.type === 'string' ? element.type.toLowerCase() : '';
  if (elType !== 'node' && elType !== 'way' && elType !== 'relation') {
    return { ok: false, reason: 'unexpected_element_type' };
  }

  const elId =
    typeof element.id === 'number' && Number.isInteger(element.id) && element.id > 0
      ? String(element.id)
      : typeof element.id === 'string' && /^\d+$/.test(element.id.trim())
        ? element.id.trim()
        : '';
  if (!elId) {
    return { ok: false, reason: 'missing_element_id' };
  }

  if (!element.tags || typeof element.tags !== 'object' || Array.isArray(element.tags)) {
    return { ok: false, reason: 'missing_tags' };
  }
  const tags = element.tags;

  // Require an explicit name (`name` or `name:en`); unnamed buildings/nodes are skipped.
  const name =
    cleanTagString(tags, 'name', DISCOVERY_LIMITS.businessName) ??
    cleanTagString(tags, 'name:en', DISCOVERY_LIMITS.businessName);
  if (!name) {
    return { ok: false, reason: 'missing_name' };
  }

  const normalizedName = normalizeBusinessName(name);
  if (!normalizedName) {
    return { ok: false, reason: 'invalid_name' };
  }

  // Classify business tags (reject residential / non-business objects).
  const classification = classifyOsmBusinessTags(tags);
  if (!classification) {
    return { ok: false, reason: 'non_business_feature' };
  }

  if (
    context.categoryFilter &&
    context.categoryFilter.toLowerCase() !== 'all' &&
    classification.category.toLowerCase() !== context.categoryFilter.toLowerCase()
  ) {
    return { ok: false, reason: 'category_mismatch' };
  }

  // Validate geometry / center coordinates.
  const coords = extractCoordinates(element);
  if ('error' in coords) {
    return { ok: false, reason: coords.error };
  }

  // Extract address & Nigerian geographic fields without inventing missing values.
  const houseNumber = cleanTagString(tags, 'addr:housenumber', 40);
  const street = cleanTagString(tags, 'addr:street', 160);
  const neighbourhood =
    cleanTagString(tags, 'addr:suburb', 100) ??
    cleanTagString(tags, 'addr:neighbourhood', 100) ??
    cleanTagString(tags, 'addr:quarter', 100);
  const city =
    cleanTagString(tags, 'addr:city', DISCOVERY_LIMITS.city) ??
    cleanTagString(tags, 'addr:town', DISCOVERY_LIMITS.city);
  const postalCode = cleanTagString(tags, 'addr:postcode', 20);

  let state: string | null = null;
  const rawAddrState = cleanTagString(tags, 'addr:state', DISCOVERY_LIMITS.state + 20);
  if (rawAddrState) {
    try {
      state = normalizeNigerianState(rawAddrState);
    } catch {
      state = null;
    }
  }
  if (!state && context.stateHint) {
    try {
      state = normalizeNigerianState(context.stateHint);
    } catch {
      state = null;
    }
  }

  const lga =
    cleanTagString(tags, 'addr:lga', DISCOVERY_LIMITS.lga) ??
    cleanTagString(tags, 'addr:district', DISCOVERY_LIMITS.lga) ??
    cleanTagString(tags, 'addr:county', DISCOVERY_LIMITS.lga) ??
    (context.lgaHint ? cleanText(context.lgaHint, DISCOVERY_LIMITS.lga) || null : null);

  const addressParts: string[] = [];
  if (houseNumber && street) addressParts.push(`${houseNumber} ${street}`);
  else if (street) addressParts.push(street);
  else if (houseNumber) addressParts.push(houseNumber);
  if (neighbourhood) addressParts.push(neighbourhood);
  if (city && (!street || !street.toLowerCase().includes(city.toLowerCase()))) {
    addressParts.push(city);
  }
  const address =
    addressParts.length > 0
      ? cleanText(addressParts.join(', '), DISCOVERY_LIMITS.address)
      : cleanTagString(tags, 'addr:full', DISCOVERY_LIMITS.address);

  const { phone, secondaryPhone } = extractPhones(tags);
  const website = extractWebsite(tags);
  const email = extractEmail(tags);
  const openingHours = cleanTagString(tags, 'opening_hours', DISCOVERY_LIMITS.openingHours);
  const description = cleanTagString(tags, 'description', DISCOVERY_LIMITS.description);
  const brand = cleanTagString(tags, 'brand', 120);
  const operator = cleanTagString(tags, 'operator', 120);

  const sourceRecordId = `${elType}/${elId}`;
  const sourceRecordType = `osm_${elType}`;
  const sourceUrl = `https://www.openstreetmap.org/${sourceRecordId}`;
  const sourceTimestamp = parseOsmTimestamp(element.timestamp);

  // Conservative discovery confidence score (max 0.65 — OSM alone is never verified proof).
  let confidence = 0.3;
  if (classification.matchedTagKey !== 'building') confidence += 0.1;
  if (address || street) confidence += 0.08;
  if (phone || website || email) confidence += 0.08;
  if (openingHours) confidence += 0.04;
  if (state || city) confidence += 0.05;
  const confidenceScore = Math.min(0.65, Number(confidence.toFixed(2)));

  // Preserve original stringified tags cleanly for auditability.
  const preservedTags: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) {
    if (typeof v === 'string') preservedTags[k] = v;
  }

  const rawSourceData: Record<string, unknown> = {
    type: elType,
    id: Number(elId),
    lat: coords.latitude,
    lon: coords.longitude,
    timestamp: element.timestamp ?? null,
    version: typeof element.version === 'number' ? element.version : null,
    tags: preservedTags,
  };

  const normalizedData: Record<string, unknown> = {
    osmElementType: elType,
    osmElementId: elId,
    matchedTagKey: classification.matchedTagKey,
    matchedTagValue: classification.matchedTagValue,
    street,
    houseNumber,
    neighbourhood,
    city,
    state,
    lga,
    postalCode,
    brand,
    operator,
    osmTags: preservedTags,
  };

  const identityHash = computeIdentityHashSync([
    normalizedName,
    state,
    lga,
    coords.latitude.toFixed(3),
    coords.longitude.toFixed(3),
  ]);

  const evidence: CandidateEvidenceInput[] = [
    {
      evidenceType: 'source_record',
      fieldName: 'osm_element',
      evidenceValue: JSON.stringify({
        sourceRecordId,
        matchedTag: `${classification.matchedTagKey}=${classification.matchedTagValue}`,
        tags: preservedTags,
      }),
      sourceUrl,
      sourceRecordId,
      sourceTimestamp,
      confidence: confidenceScore,
      notes: 'OpenStreetMap discovery snapshot (unverified external signal; not proof of current operation).',
    },
    {
      evidenceType: 'field_extraction',
      fieldName: 'name',
      evidenceValue: name,
      sourceUrl,
      sourceRecordId,
      sourceTimestamp,
      confidence: confidenceScore,
    },
    {
      evidenceType: 'geocode',
      fieldName: 'coordinates',
      evidenceValue: `${coords.latitude},${coords.longitude}`,
      sourceUrl,
      sourceRecordId,
      sourceTimestamp,
      confidence: 0.6,
    },
  ];

  const optionalEvidenceFields: Array<[string, string | null]> = [
    ['category', `${classification.category} (${classification.subcategory})`],
    ['phone', phone],
    ['secondary_phone', secondaryPhone],
    ['website', website],
    ['email', email],
    ['opening_hours', openingHours],
    ['address', address],
    ['brand', brand],
    ['operator', operator],
  ];

  for (const [fieldName, value] of optionalEvidenceFields) {
    if (value) {
      evidence.push({
        evidenceType: 'field_extraction',
        fieldName,
        evidenceValue: value,
        sourceUrl,
        sourceRecordId,
        sourceTimestamp,
        confidence: confidenceScore,
      });
    }
  }

  return {
    ok: true,
    candidate: {
      sourceRecordId,
      sourceRecordType,
      sourceUrl,
      name,
      normalizedName,
      category: classification.category,
      subcategory: classification.subcategory,
      country: context.country ?? 'Nigeria',
      state,
      lga,
      city,
      address,
      phone,
      secondaryPhone,
      email,
      website,
      latitude: coords.latitude,
      longitude: coords.longitude,
      openingHours,
      description,
      brand,
      operator,
      rawSourceData,
      normalizedData,
      identityHash,
      confidenceScore,
      sourceTimestamp,
      evidence,
    },
  };
}
