/**
 * Member-generated content client services backed by Cloudflare D1 (`/api/v1/*`).
 *
 * Client-side validation runs before calling the Worker API for fast feedback,
 * and the Worker independently validates, enforces auth/ban/email-verification,
 * and writes safely to D1.
 */
import type { AuthUser as User } from '../context/AuthContext';
import { LIMITS } from '../lib/config';
import { ApiClientError, apiFetch, emitDataRefresh } from '../lib/apiClient';
import {
  cleanEmail,
  cleanMultiline,
  cleanPhone,
  cleanText,
  compact,
  safeGoogleMapsUrl,
  safeHttpUrl,
  safeMediaUrl,
  safeSocialUrl,
} from '../lib/security';
import { CATEGORIES, STATES_DATA } from '../data/nigeriaData';
import { MARKETPLACE_CATEGORIES } from '../data/marketplaceData';
import {
  Business,
  BusinessReview,
  ClaimRecord,
  MarketplaceCategory,
  MarketplaceCondition,
  MarketplaceItem,
  ReportReason,
  ReportTargetType,
  REPORT_REASONS,
} from '../types';

/** An error whose message is safe and helpful to show to the visitor as-is. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const fail = (msg: string): never => {
  throw new ValidationError(msg);
};

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

export function toMillis(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

export function timeAgo(ms?: number): string {
  if (!ms) return 'Just now';
  const secs = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (secs < 60) return 'Just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Validators (form input → clean, Worker-compatible payloads)
// ---------------------------------------------------------------------------

export interface BusinessInput {
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
  priceLevel?: string;
  paymentMethods?: string[];
  socials?: Partial<Record<'instagram' | 'twitter' | 'facebook' | 'linkedin' | 'tiktok', string>>;
  tags?: string[];
  openingHours?: string;
  description?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  gallery?: string[];
}

const CATEGORY_KEYS = CATEGORIES.filter((c) => c.key !== 'All').map((c) => c.key);
const STATE_NAMES = STATES_DATA.map((s) => s.name);

function optionalPhone(value: unknown, label: string): string | undefined {
  const raw = cleanText(value, LIMITS.phone);
  if (!raw) return undefined;
  return cleanPhone(raw) ?? fail(`${label} doesn't look like a valid phone number.`);
}

export function validateBusiness(input: BusinessInput): BusinessInput {
  const name = cleanText(input.name, LIMITS.name);
  if (name.length < 2) fail('Please enter the business name.');

  if (!CATEGORY_KEYS.includes(input.category)) fail('Please choose a category.');
  if (!STATE_NAMES.includes(input.state)) fail('Please choose a state.');

  const lga = cleanText(input.lga, LIMITS.lga);
  if (!lga) fail('Please choose or enter the Local Government Area.');

  const address = cleanText(input.address, LIMITS.address);
  if (address.length < 3) fail('Please enter the street address.');

  const phone = cleanPhone(input.phone) ?? fail('Please enter a valid phone number (digits only, e.g. 08031234567).');

  const googleMapUrl =
    safeGoogleMapsUrl(input.googleMapUrl) ??
    fail('Please paste a valid Google Maps link (maps.app.goo.gl, google.com/maps or maps.google.com).');

  const email = input.email?.trim() ? (cleanEmail(input.email) ?? fail('That email address is not valid.')) : undefined;

  let website: string | undefined;
  if (input.website?.trim()) {
    const upgraded = input.website.trim().replace(/^http:\/\//i, 'https://');
    website = safeHttpUrl(upgraded, { httpsOnly: true, max: LIMITS.url }) ?? fail('The website address is not valid.');
  }

  const socials: NonNullable<BusinessInput['socials']> = {};
  (['instagram', 'twitter', 'facebook', 'linkedin', 'tiktok'] as const).forEach((p) => {
    const raw = input.socials?.[p];
    if (raw && raw.trim()) {
      socials[p] = safeSocialUrl(p, raw) ?? fail(`The ${p} link must be a valid ${p} address.`);
    }
  });

  let yearEstablished: number | undefined;
  if (input.yearEstablished !== undefined && !Number.isNaN(input.yearEstablished)) {
    const y = Math.trunc(input.yearEstablished);
    if (y < 1800 || y > new Date().getFullYear()) fail('Please enter a valid year of establishment.');
    yearEstablished = y;
  }

  const list = (arr: string[] | undefined, max: number) =>
    (arr ?? []).map((x) => cleanText(x, 40)).filter(Boolean).slice(0, max);

  let logoUrl: string | undefined;
  if (input.logoUrl?.trim()) {
    logoUrl =
      safeMediaUrl(input.logoUrl, { max: 600 }) ??
      fail('The business logo must be an uploaded photo or valid https:// address.');
  }

  let coverImageUrl: string | undefined;
  if (input.coverImageUrl?.trim()) {
    coverImageUrl =
      safeMediaUrl(input.coverImageUrl, { max: 600 }) ??
      fail('The cover photo must be an uploaded photo or valid https:// address.');
  }

  const gallery = (input.gallery ?? [])
    .map((u) => safeMediaUrl(u, { max: 600 }))
    .filter((u): u is string => Boolean(u))
    .slice(0, LIMITS.businessGallery);

  return compact({
    name,
    category: input.category,
    state: input.state,
    lga,
    address,
    landmark: cleanText(input.landmark, LIMITS.landmark),
    googleMapUrl,
    phone,
    secondaryPhone: optionalPhone(input.secondaryPhone, 'The second phone number'),
    whatsapp: optionalPhone(input.whatsapp, 'The WhatsApp number'),
    email,
    website,
    cacStatus: input.cacStatus && ['registered', 'pending', 'unregistered'].includes(input.cacStatus) ? input.cacStatus : undefined,
    cacNumber: cleanText(input.cacNumber, LIMITS.cac).toUpperCase(),
    yearEstablished,
    priceLevel: ['₦', '₦₦', '₦₦₦', '₦₦₦₦'].includes(input.priceLevel ?? '') ? input.priceLevel : undefined,
    paymentMethods: list(input.paymentMethods, LIMITS.payments),
    socials,
    tags: list(input.tags, LIMITS.tags),
    openingHours: cleanText(input.openingHours, LIMITS.hours),
    description: cleanMultiline(input.description, LIMITS.description),
    logoUrl,
    coverImageUrl,
    gallery,
  }) as BusinessInput;
}

export interface AdInput {
  businessId?: string;
  businessName: string;
  title: string;
  category: MarketplaceCategory;
  price: number;
  isNegotiable: boolean;
  condition: MarketplaceCondition;
  description: string;
  imageUrl: string;
  additionalImages?: string[];
  state: string;
  lga: string;
  locationHub?: string;
  phone: string;
  whatsapp?: string;
  cacNumber?: string;
}

const AD_CATEGORY_KEYS = MARKETPLACE_CATEGORIES.filter((c) => c.key !== 'All').map((c) => c.key as string);
const AD_CONDITIONS = ['Brand New', 'Foreign Used (Tokunbo)', 'Nigerian Used', 'Refurbished'];

export function validateAd(input: AdInput): AdInput {
  const title = cleanText(input.title, LIMITS.title);
  if (title.length < 3) fail('Please give your ad a clear title.');

  const businessName = cleanText(input.businessName, LIMITS.name);
  if (businessName.length < 2) fail('Please enter the seller or store name.');

  if (!AD_CATEGORY_KEYS.includes(input.category)) fail('Please choose a category.');
  if (!AD_CONDITIONS.includes(input.condition)) fail('Please choose the item condition.');
  if (!STATE_NAMES.includes(input.state)) fail('Please choose a state.');

  const price = Math.round(Number(input.price));
  if (!Number.isFinite(price) || price <= 0 || price > 100_000_000_000) fail('Please enter a valid price in Naira (₦).');

  const phone = cleanPhone(input.phone) ?? fail('Please enter a valid phone number (digits only, e.g. 08031234567).');

  const imageUrl =
    safeMediaUrl(input.imageUrl, { max: 600 }) ??
    fail('The image link must be an uploaded photo or valid web address starting with https://');

  const extra = (input.additionalImages ?? [])
    .map((u) => safeMediaUrl(u, { max: 600 }))
    .filter((u): u is string => Boolean(u))
    .slice(0, LIMITS.adImages);

  const description = cleanMultiline(input.description, LIMITS.description);
  if (!description) fail('Please add a short description of the item.');

  return compact({
    businessId: input.businessId,
    businessName,
    title,
    category: input.category,
    price,
    isNegotiable: !!input.isNegotiable,
    condition: input.condition,
    description,
    imageUrl,
    additionalImages: extra,
    state: input.state,
    lga: cleanText(input.lga, LIMITS.lga) || input.state,
    locationHub: cleanText(input.locationHub, LIMITS.locationHub),
    phone,
    whatsapp: optionalPhone(input.whatsapp, 'The WhatsApp number'),
    cacNumber: cleanText(input.cacNumber, LIMITS.cac).toUpperCase(),
  }) as AdInput;
}

function rethrowValidation(err: unknown): never {
  if (err instanceof ApiClientError && err.code === 'VALIDATION_ERROR') {
    throw new ValidationError(err.message);
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Writes (D1 via /api/v1/*)
// ---------------------------------------------------------------------------

export async function submitBusiness(_user: User, _displayName: string | undefined, input: BusinessInput): Promise<string> {
  const clean = validateBusiness(input);
  try {
    const res = await apiFetch<{ item: Business }>('/api/v1/directory/businesses', {
      method: 'POST',
      body: clean,
    });
    emitDataRefresh();
    return res.item.id;
  } catch (err) {
    rethrowValidation(err);
  }
}

export async function updateMyBusiness(id: string, input: BusinessInput): Promise<Business> {
  const clean = validateBusiness(input);
  try {
    const res = await apiFetch<{ item: Business }>(
      `/api/v1/directory/businesses/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: clean,
      },
    );
    emitDataRefresh();
    return res.item;
  } catch (err) {
    rethrowValidation(err);
  }
}

export async function submitAd(
  _user: User,
  _displayName: string | undefined,
  input: AdInput,
  _needsApproval: boolean,
): Promise<{ id: string; status: 'active' | 'pending' }> {
  const clean = validateAd(input);
  try {
    const res = await apiFetch<{ item: MarketplaceItem }>('/api/v1/marketplace/ads', {
      method: 'POST',
      body: clean,
    });
    emitDataRefresh();
    const status = res.item.status === 'pending' ? 'pending' : 'active';
    return { id: res.item.id, status };
  } catch (err) {
    rethrowValidation(err);
  }
}

export async function deleteMyBusiness(id: string): Promise<void> {
  await apiFetch<{ deleted: boolean }>(`/api/v1/directory/businesses/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  emitDataRefresh();
}

export async function deleteMyAd(id: string): Promise<void> {
  await apiFetch<{ deleted: boolean }>(`/api/v1/marketplace/ads/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  emitDataRefresh();
}

// ---------------------------------------------------------------------------
// "My submissions"
// ---------------------------------------------------------------------------

export interface MySubmissions {
  businesses: Business[];
  ads: MarketplaceItem[];
  claims: ClaimRecord[];
}

export async function fetchMySubmissions(_uid: string): Promise<MySubmissions> {
  return apiFetch<MySubmissions>('/api/v1/me/submissions');
}

// ---------------------------------------------------------------------------
// Favourites (bookmarks)
// ---------------------------------------------------------------------------

export async function fetchFavourites(): Promise<string[]> {
  const res = await apiFetch<{ businessIds: string[] }>('/api/v1/directory/favourites');
  return res.businessIds;
}

export async function syncFavourites(businessIds: string[]): Promise<string[]> {
  const res = await apiFetch<{ businessIds: string[] }>('/api/v1/directory/favourites/sync', {
    method: 'POST',
    body: { businessIds },
  });
  return res.businessIds;
}

export async function addFavourite(businessId: string): Promise<string[]> {
  const res = await apiFetch<{ businessIds: string[] }>(
    `/api/v1/directory/favourites/${encodeURIComponent(businessId)}`,
    { method: 'PUT' },
  );
  return res.businessIds;
}

export async function removeFavourite(businessId: string): Promise<string[]> {
  const res = await apiFetch<{ businessIds: string[] }>(
    `/api/v1/directory/favourites/${encodeURIComponent(businessId)}`,
    { method: 'DELETE' },
  );
  return res.businessIds;
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export async function fetchReviews(businessId: string): Promise<BusinessReview[]> {
  const res = await apiFetch<{ items: BusinessReview[] }>(
    `/api/v1/directory/businesses/${encodeURIComponent(businessId)}/reviews?pageSize=100`,
  );
  return res.items.map((r) => ({
    ...r,
    date: r.date || timeAgo(r.createdAt),
  }));
}

export async function addReview(
  _user: User,
  _authorName: string | undefined,
  businessId: string,
  rating: number,
  comment: string,
): Promise<void> {
  const text = cleanMultiline(comment, LIMITS.review);
  if (text.length < 3) fail('Please write a few words about your experience.');
  const stars = Math.round(rating);
  if (stars < 1 || stars > 5) fail('Please choose a rating from 1 to 5.');

  try {
    await apiFetch<{ item: BusinessReview }>(
      `/api/v1/directory/businesses/${encodeURIComponent(businessId)}/reviews`,
      {
        method: 'POST',
        body: { rating: stars, comment: text },
      },
    );
    emitDataRefresh();
  } catch (err) {
    if (err instanceof ApiClientError && err.code === 'ALREADY_EXISTS') {
      fail("You've already reviewed this business.");
    }
    rethrowValidation(err);
  }
}

export async function deleteReview(reviewId: string): Promise<void> {
  await apiFetch<{ deleted: boolean }>(`/api/v1/directory/reviews/${encodeURIComponent(reviewId)}`, {
    method: 'DELETE',
  });
  emitDataRefresh();
}

// ---------------------------------------------------------------------------
// Reports & claims
// ---------------------------------------------------------------------------

export async function submitReport(
  _user: User,
  _reporterName: string | undefined,
  target: { type: ReportTargetType; id: string; title: string },
  reason: ReportReason,
  details: string,
): Promise<void> {
  if (!REPORT_REASONS.includes(reason)) fail('Please choose a reason.');
  try {
    await apiFetch('/api/v1/reports', {
      method: 'POST',
      body: compact({
        targetType: target.type,
        targetId: target.id,
        targetTitle: cleanText(target.title, LIMITS.title) || 'Untitled',
        reason,
        details: cleanMultiline(details, LIMITS.reportDetails),
      }),
    });
  } catch (err) {
    if (err instanceof ApiClientError && err.code === 'ALREADY_EXISTS') {
      fail("We couldn't send your report. If you've already reported this, our team is already looking into it.");
    }
    rethrowValidation(err);
  }
}

export const CLAIM_ROLES = ['Owner / Founder', 'General Manager', 'Marketing & PR', 'Authorized Agent'] as const;

export async function submitClaim(
  _user: User,
  business: { id: string; name: string },
  data: {
    name: string;
    email: string;
    phone: string;
    role: string;
    proofNote?: string;
    proofAttachmentUrl?: string;
  },
): Promise<void> {
  const name = cleanText(data.name, 100);
  if (name.length < 2) fail('Please enter your full name.');
  const email = cleanEmail(data.email) ?? fail('Please enter a valid email address.');
  const phone = cleanPhone(data.phone) ?? fail('Please enter a valid phone number.');
  if (!(CLAIM_ROLES as readonly string[]).includes(data.role)) fail('Please choose your role.');

  const proofAttachmentUrl = data.proofAttachmentUrl
    ? (safeMediaUrl(data.proofAttachmentUrl, { max: 600, allowPrivate: true }) ??
      fail('The proof attachment reference is invalid.'))
    : undefined;

  try {
    await apiFetch('/api/v1/claims', {
      method: 'POST',
      body: compact({
        businessId: business.id,
        businessName: cleanText(business.name, 150),
        name,
        email,
        phone,
        role: data.role,
        proofNote: cleanMultiline(data.proofNote, 1000),
        proofAttachmentUrl,
      }),
    });
    emitDataRefresh();
  } catch (err) {
    if (err instanceof ApiClientError && err.code === 'ALREADY_EXISTS') {
      fail("We couldn't submit your claim. If you've already claimed this business, our team is reviewing it.");
    }
    rethrowValidation(err);
  }
}

// ---------------------------------------------------------------------------
// Contact form & newsletter (open to visitors, so heavily validated)
// ---------------------------------------------------------------------------

export async function sendContactMessage(
  _user: User | null,
  data: { name: string; email: string; subject: string; message: string },
): Promise<void> {
  const name = cleanText(data.name, 100);
  if (name.length < 2) fail('Please enter your name.');
  const email = cleanEmail(data.email) ?? fail('Please enter a valid email address so we can reply.');
  const subject = cleanText(data.subject, LIMITS.contactSubject);
  if (subject.length < 3) fail('Please add a short subject.');
  const message = cleanMultiline(data.message, LIMITS.contactMessage);
  if (message.length < 10) fail('Your message is a bit short. Please add a few more details.');

  try {
    await apiFetch('/api/v1/contact', {
      method: 'POST',
      body: { name, email, subject, message },
    });
  } catch (err) {
    rethrowValidation(err);
  }
}

/** Returns void on success. Duplicate subscriptions are treated as success so the list can't be probed. */
export async function subscribeNewsletter(emailInput: string, source: string): Promise<void> {
  const email = cleanEmail(emailInput) ?? fail('Please provide a valid email address.');
  const cleanSource = cleanText(source, 50) || 'homepage_banner';
  try {
    await apiFetch('/api/v1/newsletter', {
      method: 'POST',
      body: { email, source: cleanSource },
    });
  } catch (err) {
    rethrowValidation(err);
  }
}
