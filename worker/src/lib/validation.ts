import { normalizeMediaKey } from './r2';

export const LIMITS = {
  name: 120,
  category: 40,
  state: 40,
  lga: 80,
  address: 250,
  landmark: 120,
  phone: 25,
  email: 150,
  url: 300,
  mapUrl: 600,
  cac: 30,
  hours: 120,
  description: 2000,
  tags: 15,
  payments: 10,
  title: 150,
  locationHub: 150,
  adImages: 6,
  businessGallery: 6,
  review: 1000,
  reportDetails: 1000,
  contactSubject: 150,
  contactMessage: 3000,
  displayName: 100,
} as const;

export const DIRECTORY_CATEGORIES = [
  'Tech',
  'Food',
  'Hotels',
  'Health',
  'Finance',
  'Retail',
  'Auto',
  'Education',
  'Beauty',
  'Services',
  'Artisans',
] as const;

export const MARKETPLACE_CATEGORIES = [
  'Vehicles',
  'Phones & Tablets',
  'Electronics & Appliances',
  'Fashion & Beauty',
  'Home, Furniture & Living',
  'Real Estate',
  'Agriculture & Food',
  'Commercial & Industrial',
  'Services',
] as const;

export const MARKETPLACE_CONDITIONS = [
  'Brand New',
  'Foreign Used (Tokunbo)',
  'Nigerian Used',
  'Refurbished',
] as const;

export const REPORT_REASONS = [
  'Scam or fraud',
  'Fake or misleading listing',
  'Wrong or outdated information',
  'Prohibited item or service',
  'Offensive or inappropriate content',
  'Spam or duplicate',
  'Other',
] as const;

export const CLAIM_ROLES = [
  'Owner / Founder',
  'General Manager',
  'Marketing & PR',
  'Authorized Agent',
] as const;

export const NIGERIA_STATES = [
  'Abia',
  'Adamawa',
  'Akwa Ibom',
  'Anambra',
  'Bauchi',
  'Bayelsa',
  'Benue',
  'Borno',
  'Cross River',
  'Delta',
  'Ebonyi',
  'Edo',
  'Ekiti',
  'Enugu',
  'FCT',
  'Gombe',
  'Imo',
  'Jigawa',
  'Kaduna',
  'Kano',
  'Katsina',
  'Kebbi',
  'Kogi',
  'Kwara',
  'Lagos',
  'Nasarawa',
  'Niger',
  'Ogun',
  'Ondo',
  'Osun',
  'Oyo',
  'Plateau',
  'Rivers',
  'Sokoto',
  'Taraba',
  'Yobe',
  'Zamfara',
] as const;

export const STATE_ZONE_MAP: Record<string, string> = {
  abia: 'SE',
  adamawa: 'NE',
  'akwa ibom': 'SS',
  anambra: 'SE',
  bauchi: 'NE',
  bayelsa: 'SS',
  benue: 'NC',
  borno: 'NE',
  'cross river': 'SS',
  delta: 'SS',
  ebonyi: 'SE',
  edo: 'SS',
  ekiti: 'SW',
  enugu: 'SE',
  fct: 'NC',
  gombe: 'NE',
  imo: 'SE',
  jigawa: 'NW',
  kaduna: 'NW',
  kano: 'NW',
  katsina: 'NW',
  kebbi: 'NW',
  kogi: 'NC',
  kwara: 'NC',
  lagos: 'SW',
  nasarawa: 'NC',
  niger: 'NC',
  ogun: 'SW',
  ondo: 'SW',
  osun: 'SW',
  oyo: 'SW',
  plateau: 'NC',
  rivers: 'SS',
  sokoto: 'NW',
  taraba: 'NE',
  yobe: 'NE',
  zamfara: 'NW',
};

export class ValidationError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.status = status;
    this.code = code;
  }
}

function fail(message: string): never {
  throw new ValidationError(message);
}

// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const DANGEROUS_SCHEMES = /^(javascript|data|vbscript|file|blob|about|ftp):/i;
const EMAIL_RE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(INVISIBLE, '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

export function cleanMultiline(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(INVISIBLE, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

export function safeHttpUrl(
  value: unknown,
  opts: { httpsOnly?: boolean; max?: number } = {},
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.replace(INVISIBLE, '').trim();
  if (!raw || raw.length > (opts.max ?? 500)) return undefined;
  if (DANGEROUS_SCHEMES.test(raw)) return undefined;

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(candidate);
    const okProtocol = u.protocol === 'https:' || (u.protocol === 'http:' && !opts.httpsOnly);
    if (!okProtocol) return undefined;
    if (u.username || u.password) return undefined;
    if (!u.hostname.includes('.')) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

/**
 * Accepts either a canonical Worker/R2 `/api/media/<key>` path or a safe `https://` URL.
 */
export function safeMediaUrl(
  value: unknown,
  opts: { max?: number; allowPrivate?: boolean } = {},
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.replace(INVISIBLE, '').trim();
  if (!raw || raw.length > (opts.max ?? 600)) return undefined;
  if (DANGEROUS_SCHEMES.test(raw)) return undefined;

  if (raw.startsWith('/api/media/')) {
    const rest = raw.slice('/api/media/'.length);
    if (!rest || rest.includes('?') || rest.includes('#')) return undefined;
    const key = normalizeMediaKey(rest);
    if (!key) return undefined;
    if (!opts.allowPrivate && key.startsWith('private/')) return undefined;
    return `/api/media/${key}`;
  }

  return safeHttpUrl(raw, { httpsOnly: true, max: opts.max ?? 600 });
}

export function safeGoogleMapsUrl(value: unknown): string | undefined {
  const url = safeHttpUrl(value, { httpsOnly: true, max: 600 });
  if (!url) return undefined;
  const { hostname, pathname } = new URL(url);
  const host = hostname.toLowerCase();

  if (host === 'maps.app.goo.gl' || host === 'g.page') return url;
  if (host === 'goo.gl' && pathname.startsWith('/maps')) return url;
  if (/^(www\.|maps\.)?google\.com(\.ng)?$/.test(host) && (host.startsWith('maps.') || pathname.startsWith('/maps'))) {
    return url;
  }
  return undefined;
}

const SOCIAL_HOSTS: Record<'instagram' | 'twitter' | 'facebook' | 'linkedin' | 'tiktok', RegExp> = {
  instagram: /(^|\.)instagram\.com$/,
  twitter: /(^|\.)(x|twitter)\.com$/,
  facebook: /(^|\.)(facebook|fb)\.com$/,
  linkedin: /(^|\.)linkedin\.com$/,
  tiktok: /(^|\.)tiktok\.com$/,
};

export function safeSocialUrl(
  platform: keyof typeof SOCIAL_HOSTS,
  value: unknown,
): string | undefined {
  const url = safeHttpUrl(value, { httpsOnly: true, max: 200 });
  if (!url) return undefined;
  return SOCIAL_HOSTS[platform].test(new URL(url).hostname.toLowerCase()) ? url : undefined;
}

export function cleanPhone(value: unknown): string | undefined {
  const raw = cleanText(value, 25);
  if (!/^[0-9+()\-\s]{7,25}$/.test(raw)) return undefined;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? raw : undefined;
}

export function cleanEmail(value: unknown): string | undefined {
  const v = cleanText(value, 150).toLowerCase();
  return EMAIL_RE.test(v) ? v : undefined;
}

function optionalPhone(value: unknown, label: string): string | undefined {
  const raw = cleanText(value, LIMITS.phone);
  if (!raw) return undefined;
  return cleanPhone(raw) ?? fail(`${label} doesn't look like a valid phone number.`);
}

export interface ValidatedBusinessInput {
  name: string;
  category: string;
  state: string;
  lga: string;
  address: string;
  landmark?: string;
  googleMapUrl: string;
  phone: string;
  secondaryPhone?: string;
  whatsapp?: string;
  email?: string;
  website?: string;
  cacStatus?: 'registered' | 'pending' | 'unregistered';
  cacNumber?: string;
  yearEstablished?: number;
  priceLevel?: '₦' | '₦₦' | '₦₦₦' | '₦₦₦₦';
  paymentMethods: string[];
  socials: Partial<Record<'instagram' | 'twitter' | 'facebook' | 'linkedin' | 'tiktok', string>>;
  tags: string[];
  openingHours?: string;
  description?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  gallery: string[];
}

export function validateBusinessInput(input: Record<string, unknown>): ValidatedBusinessInput {
  const name = cleanText(input.name, LIMITS.name);
  if (name.length < 2) fail('Please enter the business name.');

  const category = cleanText(input.category, LIMITS.category);
  if (!(DIRECTORY_CATEGORIES as readonly string[]).includes(category)) fail('Please choose a category.');

  const state = cleanText(input.state, LIMITS.state);
  if (!(NIGERIA_STATES as readonly string[]).includes(state)) fail('Please choose a state.');

  const lga = cleanText(input.lga, LIMITS.lga);
  if (!lga) fail('Please choose or enter the Local Government Area.');

  const address = cleanText(input.address, LIMITS.address);
  if (address.length < 3) fail('Please enter the street address.');

  const phone =
    cleanPhone(input.phone) ??
    fail('Please enter a valid phone number (digits only, e.g. 08031234567).');

  const googleMapUrl =
    safeGoogleMapsUrl(input.googleMapUrl) ??
    fail('Please paste a valid Google Maps link (maps.app.goo.gl, google.com/maps or maps.google.com).');

  const rawEmail = typeof input.email === 'string' ? input.email.trim() : '';
  const email = rawEmail ? (cleanEmail(rawEmail) ?? fail('That email address is not valid.')) : undefined;

  let website: string | undefined;
  const rawWebsite = typeof input.website === 'string' ? input.website.trim() : '';
  if (rawWebsite) {
    const upgraded = rawWebsite.replace(/^http:\/\//i, 'https://');
    website =
      safeHttpUrl(upgraded, { httpsOnly: true, max: LIMITS.url }) ??
      fail('The website address is not valid.');
  }

  const rawSocials =
    input.socials && typeof input.socials === 'object'
      ? (input.socials as Record<string, unknown>)
      : {};
  const socials: ValidatedBusinessInput['socials'] = {};
  (['instagram', 'twitter', 'facebook', 'linkedin', 'tiktok'] as const).forEach((p) => {
    const raw = rawSocials[p];
    if (typeof raw === 'string' && raw.trim()) {
      socials[p] = safeSocialUrl(p, raw) ?? fail(`The ${p} link must be a valid ${p} address.`);
    }
  });

  let yearEstablished: number | undefined;
  if (
    input.yearEstablished !== undefined &&
    input.yearEstablished !== null &&
    input.yearEstablished !== '' &&
    !Number.isNaN(Number(input.yearEstablished))
  ) {
    const y = Math.trunc(Number(input.yearEstablished));
    const currentYear = new Date().getUTCFullYear();
    if (y < 1800 || y > currentYear) fail('Please enter a valid year of establishment.');
    yearEstablished = y;
  }

  const cleanList = (arr: unknown, max: number): string[] =>
    Array.isArray(arr)
      ? arr.map((x) => cleanText(x, 40)).filter(Boolean).slice(0, max)
      : [];

  const rawCacStatus = cleanText(input.cacStatus, 20);
  const cacStatus = ['registered', 'pending', 'unregistered'].includes(rawCacStatus)
    ? (rawCacStatus as 'registered' | 'pending' | 'unregistered')
    : undefined;

  const rawPrice = cleanText(input.priceLevel, 10);
  const priceLevel = ['₦', '₦₦', '₦₦₦', '₦₦₦₦'].includes(rawPrice)
    ? (rawPrice as '₦' | '₦₦' | '₦₦₦' | '₦₦₦₦')
    : undefined;

  let logoUrl: string | undefined;
  if (typeof input.logoUrl === 'string' && input.logoUrl.trim()) {
    logoUrl =
      safeMediaUrl(input.logoUrl, { max: 600 }) ??
      fail('The business logo must be a valid uploaded image or https:// URL.');
  }

  let coverImageUrl: string | undefined;
  if (typeof input.coverImageUrl === 'string' && input.coverImageUrl.trim()) {
    coverImageUrl =
      safeMediaUrl(input.coverImageUrl, { max: 600 }) ??
      fail('The business cover photo must be a valid uploaded image or https:// URL.');
  }

  const gallery = Array.isArray(input.gallery)
    ? input.gallery
        .map((u) => safeMediaUrl(u, { max: 600 }))
        .filter((u): u is string => Boolean(u))
        .slice(0, LIMITS.businessGallery)
    : [];

  return {
    name,
    category,
    state,
    lga,
    address,
    landmark: cleanText(input.landmark, LIMITS.landmark) || undefined,
    googleMapUrl,
    phone,
    secondaryPhone: optionalPhone(input.secondaryPhone, 'The second phone number'),
    whatsapp: optionalPhone(input.whatsapp, 'The WhatsApp number'),
    email,
    website,
    cacStatus,
    cacNumber: cleanText(input.cacNumber, LIMITS.cac).toUpperCase() || undefined,
    yearEstablished,
    priceLevel,
    paymentMethods: cleanList(input.paymentMethods, LIMITS.payments),
    socials,
    tags: cleanList(input.tags, LIMITS.tags),
    openingHours: cleanText(input.openingHours, LIMITS.hours) || undefined,
    description: cleanMultiline(input.description, LIMITS.description) || undefined,
    logoUrl,
    coverImageUrl,
    gallery,
  };
}

export interface ValidatedAdminBusinessEdit {
  name: string;
  category: string;
  state: string;
  lga: string;
  address: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  website?: string;
  openingHours?: string;
  description?: string;
}

export function validateAdminBusinessEdit(
  input: Record<string, unknown>,
  fallback: { category: string; state: string; lga: string; address: string },
): ValidatedAdminBusinessEdit {
  const name = cleanText(input.name, LIMITS.name);
  if (name.length < 2) fail('The business name is too short.');

  const phone = cleanPhone(input.phone) ?? fail('The phone number is not valid.');

  const rawWa = typeof input.whatsapp === 'string' ? input.whatsapp.trim() : '';
  const whatsapp = rawWa ? (cleanPhone(rawWa) ?? fail('The WhatsApp number is not valid.')) : undefined;

  const rawEmail = typeof input.email === 'string' ? input.email.trim() : '';
  const email = rawEmail ? (cleanEmail(rawEmail) ?? fail('The email address is not valid.')) : undefined;

  const rawWebsite = typeof input.website === 'string' ? input.website.trim() : '';
  const website = rawWebsite
    ? (safeHttpUrl(rawWebsite.replace(/^http:\/\//i, 'https://'), { httpsOnly: true, max: LIMITS.url }) ??
      fail('The website address is not valid.'))
    : undefined;

  const category = cleanText(input.category, LIMITS.category) || fallback.category;
  if (!(DIRECTORY_CATEGORIES as readonly string[]).includes(category) && category !== fallback.category) {
    fail('Please choose a valid category.');
  }

  const state = cleanText(input.state, LIMITS.state) || fallback.state;
  if (!(NIGERIA_STATES as readonly string[]).includes(state) && state !== fallback.state) {
    fail('Please choose a valid state.');
  }

  return {
    name,
    category,
    state,
    lga: cleanText(input.lga, LIMITS.lga) || fallback.lga,
    address: cleanText(input.address, LIMITS.address) || fallback.address,
    phone,
    whatsapp,
    email,
    website,
    openingHours: cleanText(input.openingHours, LIMITS.hours) || undefined,
    description: cleanMultiline(input.description, LIMITS.description) || undefined,
  };
}

export interface ValidatedAdInput {
  businessId?: string;
  businessName: string;
  title: string;
  category: string;
  price: number;
  isNegotiable: boolean;
  condition: string;
  description: string;
  imageUrl: string;
  additionalImages: string[];
  state: string;
  lga: string;
  locationHub?: string;
  phone: string;
  whatsapp?: string;
  cacNumber?: string;
}

export function validateAdInput(input: Record<string, unknown>): ValidatedAdInput {
  const title = cleanText(input.title, LIMITS.title);
  if (title.length < 3) fail('Please give your ad a clear title.');

  const businessName = cleanText(input.businessName, LIMITS.name);
  if (businessName.length < 2) fail('Please enter the seller or store name.');

  const category = cleanText(input.category, LIMITS.category);
  if (!(MARKETPLACE_CATEGORIES as readonly string[]).includes(category)) fail('Please choose a category.');

  const condition = cleanText(input.condition, 40);
  if (!(MARKETPLACE_CONDITIONS as readonly string[]).includes(condition)) {
    fail('Please choose the item condition.');
  }

  const state = cleanText(input.state, LIMITS.state);
  if (!(NIGERIA_STATES as readonly string[]).includes(state)) fail('Please choose a state.');

  const price = Math.round(Number(input.price));
  if (!Number.isFinite(price) || price <= 0 || price > 100_000_000_000) {
    fail('Please enter a valid price in Naira (₦).');
  }

  const phone =
    cleanPhone(input.phone) ??
    fail('Please enter a valid phone number (digits only, e.g. 08031234567).');

  const imageUrl =
    safeMediaUrl(input.imageUrl, { max: 600 }) ??
    fail('The image link must be an uploaded photo or valid web address starting with https://');

  const additionalImages = Array.isArray(input.additionalImages)
    ? input.additionalImages
        .map((u) => safeMediaUrl(u, { max: 600 }))
        .filter((u): u is string => Boolean(u))
        .slice(0, LIMITS.adImages)
    : [];

  const description = cleanMultiline(input.description, LIMITS.description);
  if (!description) fail('Please add a short description of the item.');

  const businessId = cleanText(input.businessId, 120) || undefined;

  return {
    businessId,
    businessName,
    title,
    category,
    price,
    isNegotiable: Boolean(input.isNegotiable),
    condition,
    description,
    imageUrl,
    additionalImages,
    state,
    lga: cleanText(input.lga, LIMITS.lga) || state,
    locationHub: cleanText(input.locationHub, LIMITS.locationHub) || undefined,
    phone,
    whatsapp: optionalPhone(input.whatsapp, 'The WhatsApp number'),
    cacNumber: cleanText(input.cacNumber, LIMITS.cac).toUpperCase() || undefined,
  };
}

export function validateReviewInput(input: Record<string, unknown>): { rating: number; comment: string } {
  const comment = cleanMultiline(input.comment, LIMITS.review);
  if (comment.length < 3) fail('Please write a few words about your experience.');
  const rating = Math.round(Number(input.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    fail('Please choose a rating from 1 to 5.');
  }
  return { rating, comment };
}

export function validateClaimInput(input: Record<string, unknown>): {
  businessId: string;
  businessName: string;
  name: string;
  email: string;
  phone: string;
  role: (typeof CLAIM_ROLES)[number];
  proofNote?: string;
  proofAttachmentUrl?: string;
} {
  const businessId = cleanText(input.businessId, 160);
  if (!businessId) fail('Missing business identifier.');
  const businessName = cleanText(input.businessName, 150) || 'Business listing';
  const name = cleanText(input.name, 100);
  if (name.length < 2) fail('Please enter your full name.');
  const email = cleanEmail(input.email) ?? fail('Please enter a valid email address.');
  const phone = cleanPhone(input.phone) ?? fail('Please enter a valid phone number.');
  const role = cleanText(input.role, 60);
  if (!(CLAIM_ROLES as readonly string[]).includes(role)) fail('Please choose your role.');

  let proofAttachmentUrl: string | undefined;
  if (typeof input.proofAttachmentUrl === 'string' && input.proofAttachmentUrl.trim()) {
    proofAttachmentUrl =
      safeMediaUrl(input.proofAttachmentUrl, { max: 600, allowPrivate: true }) ??
      fail('The uploaded proof attachment reference is invalid.');
  }

  return {
    businessId,
    businessName,
    name,
    email,
    phone,
    role: role as (typeof CLAIM_ROLES)[number],
    proofNote: cleanMultiline(input.proofNote, 1000) || undefined,
    proofAttachmentUrl,
  };
}

export function validateReportInput(input: Record<string, unknown>): {
  targetType: 'business' | 'ad' | 'review';
  targetId: string;
  targetTitle: string;
  reason: (typeof REPORT_REASONS)[number];
  details?: string;
} {
  const targetType = cleanText(input.targetType, 20);
  if (targetType !== 'business' && targetType !== 'ad' && targetType !== 'review') {
    fail('Invalid report target type.');
  }
  const targetId = cleanText(input.targetId, 300);
  if (!targetId) fail('Missing report target identifier.');
  const targetTitle = cleanText(input.targetTitle, LIMITS.title) || 'Untitled';
  const reason = cleanText(input.reason, 80);
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) fail('Please choose a reason.');

  return {
    targetType,
    targetId,
    targetTitle,
    reason: reason as (typeof REPORT_REASONS)[number],
    details: cleanMultiline(input.details, LIMITS.reportDetails) || undefined,
  };
}

export function validateContactInput(input: Record<string, unknown>): {
  name: string;
  email: string;
  subject: string;
  message: string;
} {
  const name = cleanText(input.name, 100);
  if (name.length < 2) fail('Please enter your name.');
  const email =
    cleanEmail(input.email) ?? fail('Please enter a valid email address so we can reply.');
  const subject = cleanText(input.subject, LIMITS.contactSubject);
  if (subject.length < 3) fail('Please add a short subject.');
  const message = cleanMultiline(input.message, LIMITS.contactMessage);
  if (message.length < 10) {
    fail('Your message is a bit short. Please add a few more details.');
  }
  return { name, email, subject, message };
}

export function validateSettingsInput(input: Record<string, unknown>) {
  const rawEmail = typeof input.contactEmail === 'string' ? input.contactEmail.trim() : '';
  if (rawEmail && !cleanEmail(rawEmail)) {
    fail('The contact email address is not valid.');
  }
  const announcementText = cleanText(input.announcementText, 300);
  return {
    contactEmail: rawEmail.toLowerCase(),
    contactPhone: cleanText(input.contactPhone, 40),
    whatsapp: cleanText(input.whatsapp, 40),
    address: cleanText(input.address, 300),
    officeHours: cleanText(input.officeHours, 200),
    aboutStory: cleanMultiline(input.aboutStory, 5000),
    announcementEnabled: Boolean(input.announcementEnabled) && announcementText.length > 0,
    announcementText,
    adsNeedApproval: Boolean(input.adsNeedApproval),
  };
}

export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
  } catch {
    return [];
  }
}

export function parseJsonRecord(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
