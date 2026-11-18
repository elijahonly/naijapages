/**
 * Everything that reads or writes member-generated content in Firestore.
 *
 * Writes pass through the validators below (clean text, https-only links,
 * allow-listed categories) *before* hitting Firestore, and reads pass through
 * the same URL checks again on the way out. firestore.rules enforces the same
 * limits on the server, so a hand-crafted request can't skip any of this.
 */
import { User } from 'firebase/auth';
import {
  QueryDocumentSnapshot,
  DocumentSnapshot,
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { COL, LIMITS } from '../lib/config';
import {
  cleanEmail,
  cleanMultiline,
  cleanPhone,
  cleanText,
  compact,
  safeGoogleMapsUrl,
  safeHttpUrl,
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
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === 'number') return v;
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
// Firestore → app models (re-sanitising links on the way out)
// ---------------------------------------------------------------------------

type Snap = QueryDocumentSnapshot | DocumentSnapshot;
type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const FALLBACK_AD_IMAGE =
  'https://images.unsplash.com/photo-1526738549149-8e07eca6c147?w=800&auto=format&fit=crop&q=80';

export function businessFromSnap(snap: Snap): Business {
  const d = (snap.data({ serverTimestamps: 'estimate' }) ?? {}) as Raw;
  const socials = d.socials && typeof d.socials === 'object' ? d.socials : {};
  const cleanSocials = compact({
    instagram: safeSocialUrl('instagram', socials.instagram),
    twitter: safeSocialUrl('twitter', socials.twitter),
    facebook: safeSocialUrl('facebook', socials.facebook),
    linkedin: safeSocialUrl('linkedin', socials.linkedin),
    tiktok: safeSocialUrl('tiktok', socials.tiktok),
  });

  return {
    id: snap.id,
    name: cleanText(d.name, LIMITS.name),
    category: cleanText(d.category, LIMITS.category),
    state: cleanText(d.state, LIMITS.state),
    lga: cleanText(d.lga, LIMITS.lga),
    address: cleanText(d.address, LIMITS.address),
    landmark: cleanText(d.landmark, LIMITS.landmark) || undefined,
    phone: cleanText(d.phone, LIMITS.phone),
    secondaryPhone: cleanText(d.secondaryPhone, LIMITS.phone) || undefined,
    whatsapp: cleanText(d.whatsapp, LIMITS.phone) || undefined,
    email: cleanEmail(d.email),
    website: safeHttpUrl(d.website, { max: LIMITS.url }),
    googleMapUrl: safeGoogleMapsUrl(d.googleMapUrl),
    cacStatus: ['registered', 'pending', 'unregistered'].includes(d.cacStatus) ? d.cacStatus : undefined,
    cacNumber: cleanText(d.cacNumber, LIMITS.cac) || undefined,
    yearEstablished: Number.isInteger(d.yearEstablished) ? d.yearEstablished : undefined,
    priceLevel: ['₦', '₦₦', '₦₦₦', '₦₦₦₦'].includes(d.priceLevel) ? d.priceLevel : undefined,
    paymentMethods: Array.isArray(d.paymentMethods) ? d.paymentMethods.map((p: unknown) => cleanText(p, 40)).filter(Boolean) : undefined,
    tags: Array.isArray(d.tags) ? d.tags.map((t: unknown) => cleanText(t, 40)).filter(Boolean) : undefined,
    openingHours: cleanText(d.openingHours, LIMITS.hours) || undefined,
    description: cleanMultiline(d.description, LIMITS.description) || undefined,
    socials: cleanSocials,
    rating: Number(d.rating) || 0,
    reviewsCount: Number(d.reviewsCount) || 0,
    isVerified: d.isVerified === true,
    isUserAdded: true,
    claimed: d.claimed === true,
    ownerId: typeof d.ownerId === 'string' ? d.ownerId : undefined,
    ownerName: cleanText(d.ownerName, LIMITS.displayName) || undefined,
    status: d.status,
    moderationNote: cleanText(d.moderationNote, 500) || undefined,
    createdAt: toMillis(d.createdAt),
  };
}

export function adFromSnap(snap: Snap): MarketplaceItem {
  const d = (snap.data({ serverTimestamps: 'estimate' }) ?? {}) as Raw;
  const createdAt = toMillis(d.createdAt);
  const extra: string[] = Array.isArray(d.additionalImages)
    ? d.additionalImages
        .map((u: unknown) => safeHttpUrl(u, { httpsOnly: true, max: 600 }))
        .filter((u: string | undefined): u is string => Boolean(u))
    : [];

  return {
    id: snap.id,
    businessId: typeof d.businessId === 'string' ? d.businessId : undefined,
    businessName: cleanText(d.businessName, LIMITS.name),
    title: cleanText(d.title, LIMITS.title),
    category: d.category as MarketplaceCategory,
    price: Number(d.price) || 0,
    isNegotiable: d.isNegotiable === true,
    condition: d.condition as MarketplaceCondition,
    description: cleanMultiline(d.description, LIMITS.description),
    imageUrl: safeHttpUrl(d.imageUrl, { httpsOnly: true, max: 600 }) ?? FALLBACK_AD_IMAGE,
    additionalImages: extra.length ? extra : undefined,
    state: cleanText(d.state, LIMITS.state),
    lga: cleanText(d.lga, LIMITS.lga),
    locationHub: cleanText(d.locationHub, LIMITS.locationHub) || undefined,
    phone: cleanText(d.phone, LIMITS.phone),
    whatsapp: cleanText(d.whatsapp, LIMITS.phone) || undefined,
    // Never trust a stored flag: community sellers are only "verified" if their linked business is (set in DataContext).
    isVerifiedSeller: false,
    cacNumber: cleanText(d.cacNumber, LIMITS.cac) || undefined,
    featured: false,
    viewsCount: Number(d.viewsCount) || 0,
    postedDate: timeAgo(createdAt),
    ownerId: typeof d.ownerId === 'string' ? d.ownerId : undefined,
    ownerName: cleanText(d.ownerName, LIMITS.displayName) || undefined,
    status: d.status,
    moderationNote: cleanText(d.moderationNote, 500) || undefined,
    createdAt,
  };
}

// ---------------------------------------------------------------------------
// Validators (form input → clean, rules-compatible payloads)
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
    safeHttpUrl(input.imageUrl, { httpsOnly: true, max: 600 }) ??
    fail('The image link must be a valid web address starting with https://');

  const extra = (input.additionalImages ?? [])
    .map((u) => safeHttpUrl(u, { httpsOnly: true, max: 600 }))
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

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const ownerLabel = (user: User, name?: string) =>
  cleanText(name || user.displayName || user.email?.split('@')[0] || 'Member', LIMITS.displayName);

export async function submitBusiness(user: User, displayName: string | undefined, input: BusinessInput): Promise<string> {
  const clean = validateBusiness(input);
  const ref = await addDoc(collection(db, COL.businesses), {
    ...clean,
    ownerId: user.uid,
    ownerName: ownerLabel(user, displayName),
    // Members can never set these; the rules reject anything else.
    status: 'pending',
    isVerified: false,
    rating: 0,
    reviewsCount: 0,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function submitAd(
  user: User,
  displayName: string | undefined,
  input: AdInput,
  needsApproval: boolean,
): Promise<{ id: string; status: 'active' | 'pending' }> {
  const clean = validateAd(input);
  const status = needsApproval ? 'pending' : 'active';
  const ref = await addDoc(collection(db, COL.marketplace), {
    ...clean,
    ownerId: user.uid,
    ownerName: ownerLabel(user, displayName),
    status,
    isVerifiedSeller: false,
    featured: false,
    viewsCount: 0,
    createdAt: serverTimestamp(),
  });
  return { id: ref.id, status };
}

export async function deleteMyBusiness(id: string): Promise<void> {
  await deleteDoc(doc(db, COL.businesses, id));
}

export async function deleteMyAd(id: string): Promise<void> {
  await deleteDoc(doc(db, COL.marketplace, id));
}

// ---------------------------------------------------------------------------
// "My submissions"
// ---------------------------------------------------------------------------

export interface MySubmissions {
  businesses: Business[];
  ads: MarketplaceItem[];
  claims: ClaimRecord[];
}

export function claimFromSnap(snap: Snap): ClaimRecord {
  const d = (snap.data({ serverTimestamps: 'estimate' }) ?? {}) as Raw;
  return {
    id: snap.id,
    businessId: String(d.businessId ?? ''),
    businessName: cleanText(d.businessName, 150),
    claimantId: String(d.claimantId ?? ''),
    name: cleanText(d.name, 100),
    email: cleanText(d.email, 150),
    phone: cleanText(d.phone, LIMITS.phone),
    role: cleanText(d.role, 60),
    proofNote: cleanMultiline(d.proofNote, 1000) || undefined,
    status: d.status,
    createdAt: toMillis(d.createdAt),
    reviewedBy: d.reviewedBy,
    reviewedAt: toMillis(d.reviewedAt),
    reviewNote: cleanText(d.reviewNote, 500) || undefined,
  };
}

export async function fetchMySubmissions(uid: string): Promise<MySubmissions> {
  const [b, a, c] = await Promise.all([
    getDocs(query(collection(db, COL.businesses), where('ownerId', '==', uid), limit(100))),
    getDocs(query(collection(db, COL.marketplace), where('ownerId', '==', uid), limit(100))),
    getDocs(query(collection(db, COL.claims), where('claimantId', '==', uid), limit(50))),
  ]);
  const byNewest = <T extends { createdAt?: number }>(x: T[]) => x.sort((p, q) => (q.createdAt ?? 0) - (p.createdAt ?? 0));
  return {
    businesses: byNewest(b.docs.map(businessFromSnap)),
    ads: byNewest(a.docs.map(adFromSnap)),
    claims: byNewest(c.docs.map(claimFromSnap)),
  };
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export async function fetchReviews(businessId: string): Promise<BusinessReview[]> {
  const snap = await getDocs(query(collection(db, COL.reviews), where('businessId', '==', businessId), limit(100)));
  return snap.docs
    .map((s) => {
      const d = s.data({ serverTimestamps: 'estimate' }) as Raw;
      const createdAt = toMillis(d.createdAt);
      return {
        id: s.id,
        businessId,
        author: cleanText(d.authorName, LIMITS.displayName) || 'Member',
        authorId: typeof d.authorId === 'string' ? d.authorId : undefined,
        rating: Math.min(5, Math.max(1, Math.round(Number(d.rating) || 1))),
        comment: cleanMultiline(d.comment, LIMITS.review),
        date: timeAgo(createdAt),
        createdAt,
      } satisfies BusinessReview;
    })
    .sort((p, q) => (q.createdAt ?? 0) - (p.createdAt ?? 0));
}

export async function addReview(
  user: User,
  authorName: string | undefined,
  businessId: string,
  rating: number,
  comment: string,
): Promise<void> {
  const text = cleanMultiline(comment, LIMITS.review);
  if (text.length < 3) fail('Please write a few words about your experience.');
  const stars = Math.round(rating);
  if (stars < 1 || stars > 5) fail('Please choose a rating from 1 to 5.');

  const ref = doc(db, COL.reviews, `${businessId}_${user.uid}`);
  if ((await getDoc(ref)).exists()) fail("You've already reviewed this business.");

  await setDoc(ref, {
    businessId,
    authorId: user.uid,
    authorName: ownerLabel(user, authorName),
    rating: stars,
    comment: text,
    createdAt: serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// Reports & claims
// ---------------------------------------------------------------------------

export async function submitReport(
  user: User,
  reporterName: string | undefined,
  target: { type: ReportTargetType; id: string; title: string },
  reason: ReportReason,
  details: string,
): Promise<void> {
  if (!REPORT_REASONS.includes(reason)) fail('Please choose a reason.');
  // One report per member per item: the document id is fixed, and members can't overwrite it.
  const ref = doc(db, COL.reports, `${user.uid}_${target.type}_${target.id}`);
  try {
    await setDoc(
      ref,
      compact({
        targetType: target.type,
        targetId: target.id,
        targetTitle: cleanText(target.title, LIMITS.title) || 'Untitled',
        reason,
        details: cleanMultiline(details, LIMITS.reportDetails),
        reporterId: user.uid,
        reporterName: ownerLabel(user, reporterName),
        status: 'open',
        createdAt: serverTimestamp(),
      }),
    );
  } catch (err) {
    if ((err as { code?: string })?.code === 'permission-denied') {
      fail("We couldn't send your report. If you've already reported this, our team is already looking into it.");
    }
    throw err;
  }
}

export const CLAIM_ROLES = ['Owner / Founder', 'General Manager', 'Marketing & PR', 'Authorized Agent'] as const;

export async function submitClaim(
  user: User,
  business: { id: string; name: string },
  data: { name: string; email: string; phone: string; role: string; proofNote?: string },
): Promise<void> {
  const name = cleanText(data.name, 100);
  if (name.length < 2) fail('Please enter your full name.');
  const email = cleanEmail(data.email) ?? fail('Please enter a valid email address.');
  const phone = cleanPhone(data.phone) ?? fail('Please enter a valid phone number.');
  if (!(CLAIM_ROLES as readonly string[]).includes(data.role)) fail('Please choose your role.');

  try {
    await setDoc(
      doc(db, COL.claims, `${business.id}_${user.uid}`),
      compact({
        businessId: business.id,
        businessName: cleanText(business.name, 150),
        claimantId: user.uid,
        name,
        email,
        phone,
        role: data.role,
        proofNote: cleanMultiline(data.proofNote, 1000),
        status: 'pending',
        createdAt: serverTimestamp(),
      }),
    );
  } catch (err) {
    if ((err as { code?: string })?.code === 'permission-denied') {
      fail("We couldn't submit your claim. If you've already claimed this business, our team is reviewing it.");
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Contact form & newsletter (open to visitors, so heavily validated)
// ---------------------------------------------------------------------------

export async function sendContactMessage(
  user: User | null,
  data: { name: string; email: string; subject: string; message: string },
): Promise<void> {
  const name = cleanText(data.name, 100);
  if (name.length < 2) fail('Please enter your name.');
  const email = cleanEmail(data.email) ?? fail('Please enter a valid email address so we can reply.');
  const subject = cleanText(data.subject, LIMITS.contactSubject);
  if (subject.length < 3) fail('Please add a short subject.');
  const message = cleanMultiline(data.message, LIMITS.contactMessage);
  if (message.length < 10) fail('Your message is a bit short. Please add a few more details.');

  await addDoc(
    collection(db, COL.contactMessages),
    compact({ name, email, subject, message, uid: user?.uid, status: 'new', createdAt: serverTimestamp() }),
  );
}

/** Returns true on success. Duplicate subscriptions are treated as success so the list can't be probed. */
export async function subscribeNewsletter(emailInput: string, source: string): Promise<void> {
  const email = cleanEmail(emailInput) ?? fail('Please provide a valid email address.');
  try {
    await setDoc(doc(db, COL.subscribers, email), {
      email,
      subscribedAt: new Date().toISOString(),
      source: cleanText(source, 50) || 'homepage_banner',
      status: 'active',
    });
  } catch (err) {
    if ((err as { code?: string })?.code === 'permission-denied') return; // already subscribed (documents can't be overwritten)
    throw err;
  }
}
