/**
 * Pure relational normalization, idempotent SQL generation, D1 import,
 * Firebase Storage -> R2 media migration, and data-integrity verification helpers
 * for migrating NaijaPages from Firebase to Cloudflare D1 + R2.
 */
import {
  allowedMimeTypesForPurpose,
  buildMediaDeliveryUrl,
  buildUniqueMediaKey,
  defaultVisibilityForPurpose,
  detectMagicMimeType,
  MAX_SIZE_BYTES_BY_PURPOSE,
  sha256Hex,
  type MediaEntityType,
  type MediaPurpose,
} from '../../worker/src/lib/r2';

export const DIRECTORY_CATEGORY_KEYS = new Set([
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
]);

export const MARKETPLACE_CATEGORY_KEYS = new Set([
  'Vehicles',
  'Phones & Tablets',
  'Electronics & Appliances',
  'Fashion & Beauty',
  'Home, Furniture & Living',
  'Real Estate',
  'Agriculture & Food',
  'Commercial & Industrial',
  'Services',
]);

export type FirestoreDoc = Record<string, unknown> & { id: string };

export interface FirestoreExportSnapshot {
  version: 1;
  exportedAt: string;
  projectId: string;
  databaseId?: string;
  collections: {
    users: FirestoreDoc[];
    admins: FirestoreDoc[];
    bans: FirestoreDoc[];
    businesses: FirestoreDoc[];
    marketplace_items: FirestoreDoc[];
    reviews: FirestoreDoc[];
    favourites?: FirestoreDoc[];
    claims: FirestoreDoc[];
    reports: FirestoreDoc[];
    listing_overrides: FirestoreDoc[];
    contact_messages: FirestoreDoc[];
    newsletter_subscribers: FirestoreDoc[];
    site_settings: FirestoreDoc[];
    audit_log: FirestoreDoc[];
  };
}

export interface NormalizedD1Dataset {
  users: Array<{
    id: string;
    name: string;
    email: string;
    emailVerified: number;
    image: string | null;
    role: 'user' | 'admin';
    banned: number;
    banReason: string | null;
    bannedBy: string | null;
    bannedAt: number | null;
    createdAt: number;
    updatedAt: number;
  }>;
  adminRecords: Array<{
    userId: string;
    email: string;
    addedBy: string | null;
    addedAt: number;
  }>;
  userBans: Array<{
    userId: string;
    email: string;
    name: string;
    reason: string;
    bannedBy: string | null;
    bannedAt: number;
  }>;
  businesses: Array<{
    id: string;
    ownerId: string;
    ownerName: string;
    name: string;
    categoryId: string | null;
    category: string;
    state: string;
    lga: string;
    address: string;
    landmark: string | null;
    phone: string;
    secondaryPhone: string | null;
    whatsapp: string | null;
    email: string | null;
    website: string | null;
    googleMapUrl: string;
    logoUrl: string | null;
    coverImageUrl: string | null;
    galleryJson: string;
    cacStatus: string | null;
    cacNumber: string | null;
    yearEstablished: number | null;
    priceLevel: string | null;
    paymentMethodsJson: string;
    socialsJson: string;
    tagsJson: string;
    openingHours: string | null;
    description: string | null;
    rating: number;
    reviewsCount: number;
    status: string;
    isVerified: number;
    claimed: number;
    claimedFromSeedId: string | null;
    moderationNote: string | null;
    reviewedBy: string | null;
    reviewedAt: number | null;
    createdAt: number;
    updatedAt: number;
  }>;
  marketplaceItems: Array<{
    id: string;
    ownerId: string;
    ownerName: string;
    businessId: string | null;
    businessName: string;
    categoryId: string | null;
    title: string;
    category: string;
    price: number;
    isNegotiable: number;
    condition: string;
    description: string;
    imageUrl: string;
    additionalImagesJson: string;
    state: string;
    lga: string;
    locationHub: string | null;
    phone: string;
    whatsapp: string | null;
    cacNumber: string | null;
    featured: number;
    viewsCount: number;
    status: string;
    moderationNote: string | null;
    reviewedBy: string | null;
    reviewedAt: number | null;
    createdAt: number;
    updatedAt: number;
  }>;
  reviews: Array<{
    id: string;
    businessId: string;
    authorId: string;
    authorName: string;
    rating: number;
    comment: string;
    createdAt: number;
  }>;
  favourites: Array<{
    id: string;
    userId: string;
    businessId: string;
    createdAt: number;
  }>;
  claims: Array<{
    id: string;
    businessId: string;
    businessName: string;
    claimantId: string;
    name: string;
    email: string;
    phone: string;
    role: string;
    proofNote: string | null;
    proofAttachmentUrl: string | null;
    status: string;
    reviewNote: string | null;
    reviewedBy: string | null;
    reviewedAt: number | null;
    createdAt: number;
  }>;
  mediaObjects?: Array<{
    key: string;
    ownerId: string;
    purpose: MediaPurpose;
    entityType: MediaEntityType | null;
    entityId: string | null;
    visibility: 'public' | 'private';
    contentType: string;
    sizeBytes: number;
    sha256: string | null;
    originalFilename: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
  reports: Array<{
    id: string;
    targetType: string;
    targetId: string;
    targetTitle: string;
    reason: string;
    details: string | null;
    reporterId: string;
    reporterName: string | null;
    status: string;
    resolution: string | null;
    resolvedBy: string | null;
    resolvedAt: number | null;
    createdAt: number;
  }>;
  listingOverrides: Array<{
    id: string;
    kind: 'business' | 'marketplace';
    listingId: string;
    hidden: number;
    verified: number;
    claimedBy: string | null;
    updatedBy: string | null;
    updatedAt: number;
  }>;
  contactMessages: Array<{
    id: string;
    uid: string | null;
    name: string;
    email: string;
    subject: string;
    message: string;
    status: string;
    createdAt: number;
  }>;
  newsletterSubscribers: Array<{
    email: string;
    source: string;
    status: string;
    subscribedAt: string;
    createdAt: number;
  }>;
  siteSettings: Array<{
    id: string;
    contactEmail: string;
    contactPhone: string;
    whatsapp: string;
    address: string;
    officeHours: string;
    aboutStory: string;
    announcementEnabled: number;
    announcementText: string;
    adsNeedApproval: number;
    updatedAt: number;
    updatedBy: string | null;
  }>;
  auditLog: Array<{
    id: string;
    adminId: string;
    adminEmail: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    summary: string | null;
    createdAt: number;
  }>;
}

export function toMillis(v: unknown, fallback = Date.now()): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v > 0 && v < 1e11 ? Math.trunc(v * 1000) : Math.trunc(v);
  }
  if (typeof v === 'string' && v.trim()) {
    const num = Number(v);
    if (Number.isFinite(num) && /^\d+(\.\d+)?$/.test(v.trim())) {
      return toMillis(num, fallback);
    }
    const parsed = Date.parse(v);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const sec = obj._seconds ?? obj.seconds;
    const nsec = obj._nanoseconds ?? obj.nanoseconds ?? 0;
    if (typeof sec === 'number' && Number.isFinite(sec)) {
      return Math.trunc(sec * 1000 + (typeof nsec === 'number' ? nsec / 1e6 : 0));
    }
  }
  return fallback;
}

function asStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v.trim() : fallback;
}

function asOptStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
}

export interface FirestoreRestValue {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  stringValue?: string;
  arrayValue?: { values?: FirestoreRestValue[] };
  mapValue?: { fields?: Record<string, FirestoreRestValue> };
}

export function decodeFirestoreValue(val: FirestoreRestValue | undefined): unknown {
  if (!val) return null;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('timestampValue' in val) return val.timestampValue;
  if ('stringValue' in val) return val.stringValue;
  if ('arrayValue' in val) {
    return (val.arrayValue?.values ?? []).map((item) => decodeFirestoreValue(item));
  }
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue?.fields ?? {})) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return null;
}

export function decodeFirestoreDocument(doc: {
  name: string;
  fields?: Record<string, FirestoreRestValue>;
  createTime?: string;
  updateTime?: string;
}): FirestoreDoc {
  const id = doc.name.split('/').pop() || '';
  const decoded: Record<string, unknown> = { id };
  for (const [k, v] of Object.entries(doc.fields ?? {})) {
    decoded[k] = decodeFirestoreValue(v);
  }
  if (!decoded.createdAt && doc.createTime) {
    decoded.createdAt = doc.createTime;
  }
  return decoded as FirestoreDoc;
}

export function normalizeSnapshot(snapshot: FirestoreExportSnapshot): NormalizedD1Dataset {
  const now = Date.now();
  const c = snapshot.collections;

  const adminSet = new Set<string>(c.admins.map((a) => a.id));
  const banMap = new Map<string, FirestoreDoc>(c.bans.map((b) => [b.id, b]));
  const userMap = new Map<string, NormalizedD1Dataset['users'][number]>();

  const ensureUser = (
    id: string,
    hints?: { email?: string | null; name?: string | null; createdAt?: number },
  ) => {
    const cleanId = id.trim();
    if (!cleanId) return null;
    const existing = userMap.get(cleanId);
    if (existing) return existing;

    const banDoc = banMap.get(cleanId);
    const isAdmin = adminSet.has(cleanId);
    const created = hints?.createdAt ?? now;
    const fallbackEmail = `${cleanId.replace(/[^a-zA-Z0-9._-]/g, '_')}@migrated.naijapages.local`;
    const email = (hints?.email?.trim() || asStr(banDoc?.email) || fallbackEmail).toLowerCase();
    const name = hints?.name?.trim() || asStr(banDoc?.name) || 'Migrated Member';

    const row: NormalizedD1Dataset['users'][number] = {
      id: cleanId,
      name,
      email,
      emailVerified: 1,
      image: null,
      role: isAdmin ? 'admin' : 'user',
      banned: banDoc ? 1 : 0,
      banReason: banDoc ? asOptStr(banDoc.reason) : null,
      bannedBy: banDoc ? asOptStr(banDoc.bannedBy) : null,
      bannedAt: banDoc ? toMillis(banDoc.bannedAt, now) : null,
      createdAt: created,
      updatedAt: created,
    };
    userMap.set(cleanId, row);
    return row;
  };

  for (const u of c.users) {
    const createdAt = toMillis(u.createdAt, now);
    const email = asStr(u.email).toLowerCase() || `${u.id}@migrated.naijapages.local`;
    const name = asStr(u.displayName) || asStr(u.name) || 'Member';
    const banDoc = banMap.get(u.id);
    const isAdmin = adminSet.has(u.id) || u.role === 'admin';
    if (isAdmin) adminSet.add(u.id);

    userMap.set(u.id, {
      id: u.id,
      name,
      email,
      emailVerified: u.emailVerified === false ? 0 : 1,
      image: asOptStr(u.photoURL ?? u.image),
      role: isAdmin ? 'admin' : 'user',
      banned: banDoc ? 1 : 0,
      banReason: banDoc ? asOptStr(banDoc.reason) : null,
      bannedBy: banDoc ? asOptStr(banDoc.bannedBy) : null,
      bannedAt: banDoc ? toMillis(banDoc.bannedAt, now) : null,
      createdAt,
      updatedAt: toMillis(u.updatedAt, createdAt),
    });
  }

  for (const a of c.admins) {
    ensureUser(a.id, {
      email: asOptStr(a.email),
      name: 'Administrator',
      createdAt: toMillis(a.addedAt, now),
    });
  }

  for (const b of c.bans) {
    ensureUser(b.id, {
      email: asOptStr(b.email),
      name: asOptStr(b.name),
      createdAt: toMillis(b.bannedAt, now),
    });
  }

  // Ensure users referenced by any foreign key exist before inserting dependent rows.
  for (const biz of c.businesses) {
    const ownerId = asStr(biz.ownerId, 'migrated_system');
    ensureUser(ownerId, { name: asOptStr(biz.ownerName), createdAt: toMillis(biz.createdAt, now) });
    if (asOptStr(biz.reviewedBy)) ensureUser(asStr(biz.reviewedBy));
  }
  for (const ad of c.marketplace_items) {
    const ownerId = asStr(ad.ownerId, 'migrated_system');
    ensureUser(ownerId, { name: asOptStr(ad.ownerName), createdAt: toMillis(ad.createdAt, now) });
    if (asOptStr(ad.reviewedBy)) ensureUser(asStr(ad.reviewedBy));
  }
  for (const rev of c.reviews) {
    ensureUser(asStr(rev.authorId, 'migrated_system'), {
      name: asOptStr(rev.authorName),
      createdAt: toMillis(rev.createdAt, now),
    });
  }
  for (const fav of c.favourites ?? []) {
    ensureUser(asStr(fav.userId, 'migrated_system'), { createdAt: toMillis(fav.createdAt, now) });
  }
  for (const cl of c.claims) {
    ensureUser(asStr(cl.claimantId, 'migrated_system'), {
      email: asOptStr(cl.email),
      name: asOptStr(cl.name),
      createdAt: toMillis(cl.createdAt, now),
    });
    if (asOptStr(cl.reviewedBy)) ensureUser(asStr(cl.reviewedBy));
  }
  for (const rep of c.reports) {
    ensureUser(asStr(rep.reporterId, 'migrated_system'), {
      name: asOptStr(rep.reporterName),
      createdAt: toMillis(rep.createdAt, now),
    });
    if (asOptStr(rep.resolvedBy)) ensureUser(asStr(rep.resolvedBy));
  }
  for (const ovr of c.listing_overrides) {
    if (asOptStr(ovr.claimedBy)) ensureUser(asStr(ovr.claimedBy));
    if (asOptStr(ovr.updatedBy)) ensureUser(asStr(ovr.updatedBy));
  }
  for (const aud of c.audit_log) {
    ensureUser(asStr(aud.adminId, 'migrated_system'), {
      email: asOptStr(aud.adminEmail),
      createdAt: toMillis(aud.createdAt, now),
    });
  }
  for (const b of c.bans) {
    if (asOptStr(b.bannedBy)) ensureUser(asStr(b.bannedBy));
  }
  for (const a of c.admins) {
    if (asOptStr(a.addedBy)) ensureUser(asStr(a.addedBy));
  }

  // Deduplicate user emails cleanly if synthetic/legacy collision happens
  const seenEmails = new Map<string, string>();
  for (const u of userMap.values()) {
    const key = u.email.toLowerCase();
    if (seenEmails.has(key) && seenEmails.get(key) !== u.id) {
      u.email = `${u.id.replace(/[^a-zA-Z0-9._-]/g, '_')}@migrated.naijapages.local`;
    } else {
      seenEmails.set(key, u.id);
    }
  }

  const adminRecords = Array.from(adminSet).map((uid) => {
    const aDoc = c.admins.find((a) => a.id === uid);
    const uRow = userMap.get(uid)!;
    return {
      userId: uid,
      email: asStr(aDoc?.email, uRow.email).toLowerCase(),
      addedBy: asOptStr(aDoc?.addedBy),
      addedAt: toMillis(aDoc?.addedAt, uRow.createdAt),
    };
  });

  const userBans = c.bans.map((b) => {
    const uRow = userMap.get(b.id)!;
    return {
      userId: b.id,
      email: asStr(b.email, uRow.email).toLowerCase(),
      name: asStr(b.name, uRow.name),
      reason: asStr(b.reason),
      bannedBy: asOptStr(b.bannedBy),
      bannedAt: toMillis(b.bannedAt, now),
    };
  });

  // Compute ratings from reviews per business
  const reviewAgg = new Map<string, { count: number; sum: number }>();
  const reviews = c.reviews.map((r) => {
    const businessId = asStr(r.businessId);
    const rating = Math.min(5, Math.max(1, Math.round(Number(r.rating) || 1)));
    const cur = reviewAgg.get(businessId) ?? { count: 0, sum: 0 };
    cur.count += 1;
    cur.sum += rating;
    reviewAgg.set(businessId, cur);

    return {
      id: r.id,
      businessId,
      authorId: asStr(r.authorId, 'migrated_system'),
      authorName: asStr(r.authorName, 'Member'),
      rating,
      comment: asStr(r.comment),
      createdAt: toMillis(r.createdAt, now),
    };
  });

  const businesses = c.businesses
    .filter((b) => b.isSample !== true && !/^(?:sample-|gen-|mock-|dummy-|placeholder-)|-gen-\d+$/i.test(b.id))
    .map((b) => {
    const category = asStr(b.category, 'Services');
    const createdAt = toMillis(b.createdAt, now);
    const agg = reviewAgg.get(b.id);
    const rating = agg ? Math.round((agg.sum / agg.count) * 10) / 10 : 0;
    const reviewsCount = agg ? agg.count : 0;
    const status = ['pending', 'approved', 'rejected', 'removed'].includes(asStr(b.status))
      ? asStr(b.status)
      : 'pending';

    return {
      id: b.id,
      ownerId: asStr(b.ownerId, 'migrated_system'),
      ownerName: asStr(b.ownerName),
      name: asStr(b.name, 'Untitled Business'),
      categoryId: DIRECTORY_CATEGORY_KEYS.has(category) ? `dir_${category}` : null,
      category,
      state: asStr(b.state, 'Lagos'),
      lga: asStr(b.lga, asStr(b.state, 'Lagos')),
      address: asStr(b.address),
      landmark: asOptStr(b.landmark),
      phone: asStr(b.phone),
      secondaryPhone: asOptStr(b.secondaryPhone),
      whatsapp: asOptStr(b.whatsapp),
      email: asOptStr(b.email),
      website: asOptStr(b.website),
      googleMapUrl: asStr(b.googleMapUrl),
      logoUrl: asOptStr(b.logoUrl),
      coverImageUrl: asOptStr(b.coverImageUrl ?? b.coverPhotoUrl),
      galleryJson: JSON.stringify(
        Array.isArray(b.gallery) ? b.gallery.filter((u): u is string => typeof u === 'string' && Boolean(u.trim())) : [],
      ),
      cacStatus: asOptStr(b.cacStatus),
      cacNumber: asOptStr(b.cacNumber),
      yearEstablished: typeof b.yearEstablished === 'number' ? Math.trunc(b.yearEstablished) : null,
      priceLevel: asOptStr(b.priceLevel),
      paymentMethodsJson: JSON.stringify(Array.isArray(b.paymentMethods) ? b.paymentMethods : []),
      socialsJson: JSON.stringify(b.socials && typeof b.socials === 'object' ? b.socials : {}),
      tagsJson: JSON.stringify(Array.isArray(b.tags) ? b.tags : []),
      openingHours: asOptStr(b.openingHours),
      description: asOptStr(b.description),
      rating,
      reviewsCount,
      status,
      isVerified: b.isVerified === true ? 1 : 0,
      claimed: b.claimed === true ? 1 : 0,
      claimedFromSeedId: asOptStr(b.claimedFromSeedId),
      moderationNote: asOptStr(b.moderationNote),
      reviewedBy: asOptStr(b.reviewedBy),
      reviewedAt: b.reviewedAt ? toMillis(b.reviewedAt, createdAt) : null,
      createdAt,
      updatedAt: toMillis(b.updatedAt, createdAt),
    };
  });

  const businessIdSet = new Set(businesses.map((b) => b.id));

  const marketplaceItems = c.marketplace_items
    .filter(
      (a) =>
        a.isSample !== true &&
        !/^(?:sample-|gen-|mock-|dummy-|placeholder-|mkt-(?:[1-9]|1[0-2]))$/i.test(a.id),
    )
    .map((a) => {
    const category = asStr(a.category, 'Electronics & Appliances');
    const createdAt = toMillis(a.createdAt, now);
    const rawBusinessId = asOptStr(a.businessId);
    const status = ['pending', 'active', 'removed'].includes(asStr(a.status))
      ? asStr(a.status)
      : 'active';

    return {
      id: a.id,
      ownerId: asStr(a.ownerId, 'migrated_system'),
      ownerName: asStr(a.ownerName),
      businessId: rawBusinessId && businessIdSet.has(rawBusinessId) ? rawBusinessId : null,
      businessName: asStr(a.businessName, 'Merchant'),
      categoryId: MARKETPLACE_CATEGORY_KEYS.has(category) ? `mkt_${category}` : null,
      title: asStr(a.title, 'Marketplace Listing'),
      category,
      price: Math.max(0, Math.round(Number(a.price) || 0)),
      isNegotiable: a.isNegotiable === true ? 1 : 0,
      condition: asStr(a.condition, 'Brand New'),
      description: asStr(a.description),
      imageUrl: asStr(a.imageUrl),
      additionalImagesJson: JSON.stringify(
        Array.isArray(a.additionalImages) ? a.additionalImages : [],
      ),
      state: asStr(a.state, 'Lagos'),
      lga: asStr(a.lga, asStr(a.state, 'Lagos')),
      locationHub: asOptStr(a.locationHub),
      phone: asStr(a.phone),
      whatsapp: asOptStr(a.whatsapp),
      cacNumber: asOptStr(a.cacNumber),
      featured: a.featured === true ? 1 : 0,
      viewsCount: Math.max(0, Math.trunc(Number(a.viewsCount) || 0)),
      status,
      moderationNote: asOptStr(a.moderationNote),
      reviewedBy: asOptStr(a.reviewedBy),
      reviewedAt: a.reviewedAt ? toMillis(a.reviewedAt, createdAt) : null,
      createdAt,
      updatedAt: toMillis(a.updatedAt, createdAt),
    };
  });

  // Collect favourites from dedicated collection or embedded user.favourites arrays
  const favMap = new Map<string, NormalizedD1Dataset['favourites'][number]>();
  for (const f of c.favourites ?? []) {
    const userId = asStr(f.userId);
    const businessId = asStr(f.businessId);
    if (!userId || !businessId) continue;
    const key = `${userId}:${businessId}`;
    favMap.set(key, {
      id: f.id || `${userId}_${businessId}`,
      userId,
      businessId,
      createdAt: toMillis(f.createdAt, now),
    });
  }
  for (const u of c.users) {
    if (Array.isArray(u.favourites)) {
      for (const bid of u.favourites) {
        if (typeof bid !== 'string' || !bid.trim()) continue;
        const key = `${u.id}:${bid.trim()}`;
        if (!favMap.has(key)) {
          favMap.set(key, {
            id: `${u.id}_${bid.trim()}`,
            userId: u.id,
            businessId: bid.trim(),
            createdAt: toMillis(u.createdAt, now),
          });
        }
      }
    }
  }

  const claims = c.claims.map((cl) => ({
    id: cl.id,
    businessId: asStr(cl.businessId),
    businessName: asStr(cl.businessName),
    claimantId: asStr(cl.claimantId, 'migrated_system'),
    name: asStr(cl.name),
    email: asStr(cl.email),
    phone: asStr(cl.phone),
    role: asStr(cl.role, 'Owner / Founder'),
    proofNote: asOptStr(cl.proofNote),
    proofAttachmentUrl: asOptStr(cl.proofAttachmentUrl),
    status: ['pending', 'approved', 'rejected'].includes(asStr(cl.status)) ? asStr(cl.status) : 'pending',
    reviewNote: asOptStr(cl.reviewNote),
    reviewedBy: asOptStr(cl.reviewedBy),
    reviewedAt: cl.reviewedAt ? toMillis(cl.reviewedAt, now) : null,
    createdAt: toMillis(cl.createdAt, now),
  }));

  const reports = c.reports.map((rep) => ({
    id: rep.id,
    targetType: ['business', 'ad', 'review'].includes(asStr(rep.targetType))
      ? asStr(rep.targetType)
      : 'business',
    targetId: asStr(rep.targetId),
    targetTitle: asStr(rep.targetTitle, 'Untitled'),
    reason: asStr(rep.reason, 'Other'),
    details: asOptStr(rep.details),
    reporterId: asStr(rep.reporterId, 'migrated_system'),
    reporterName: asOptStr(rep.reporterName),
    status: ['open', 'resolved', 'dismissed'].includes(asStr(rep.status)) ? asStr(rep.status) : 'open',
    resolution: asOptStr(rep.resolution),
    resolvedBy: asOptStr(rep.resolvedBy),
    resolvedAt: rep.resolvedAt ? toMillis(rep.resolvedAt, now) : null,
    createdAt: toMillis(rep.createdAt, now),
  }));

  const listingOverrides = c.listing_overrides.map((o) => {
    const kind = o.kind === 'marketplace' ? 'marketplace' : 'business';
    const listingId = o.id.startsWith(`${kind}_`) ? o.id.slice(kind.length + 1) : o.id;
    return {
      id: `${kind}_${listingId}`,
      kind: kind as 'business' | 'marketplace',
      listingId,
      hidden: o.hidden === true ? 1 : 0,
      verified: o.verified === true ? 1 : 0,
      claimedBy: asOptStr(o.claimedBy),
      updatedBy: asOptStr(o.updatedBy),
      updatedAt: toMillis(o.updatedAt, now),
    };
  });

  const contactMessages = c.contact_messages.map((m) => {
    const uid = asOptStr(m.uid);
    return {
      id: m.id,
      uid: uid && userMap.has(uid) ? uid : null,
      name: asStr(m.name, 'Visitor'),
      email: asStr(m.email),
      subject: asStr(m.subject, 'Message'),
      message: asStr(m.message),
      status: ['new', 'read', 'archived'].includes(asStr(m.status)) ? asStr(m.status) : 'new',
      createdAt: toMillis(m.createdAt, now),
    };
  });

  const subscriberMap = new Map<string, NormalizedD1Dataset['newsletterSubscribers'][number]>();
  for (const s of c.newsletter_subscribers) {
    const email = (asStr(s.email) || asStr(s.id)).toLowerCase();
    if (!email || !email.includes('@')) continue;
    const subscribedAt =
      typeof s.subscribedAt === 'string' && s.subscribedAt.trim()
        ? s.subscribedAt
        : new Date(toMillis(s.subscribedAt, now)).toISOString();
    subscriberMap.set(email, {
      email,
      source: asStr(s.source, 'homepage_banner'),
      status: asStr(s.status, 'active'),
      subscribedAt,
      createdAt: toMillis(s.subscribedAt ?? s.createdAt, now),
    });
  }

  const siteSettings = c.site_settings.map((st) => ({
    id: st.id || 'site',
    contactEmail: asStr(st.contactEmail),
    contactPhone: asStr(st.contactPhone),
    whatsapp: asStr(st.whatsapp),
    address: asStr(st.address),
    officeHours: asStr(st.officeHours),
    aboutStory: asStr(st.aboutStory),
    announcementEnabled: st.announcementEnabled === true ? 1 : 0,
    announcementText: asStr(st.announcementText),
    adsNeedApproval: st.adsNeedApproval === true ? 1 : 0,
    updatedAt: toMillis(st.updatedAt, now),
    updatedBy: asOptStr(st.updatedBy),
  }));

  const auditLog = c.audit_log.map((a) => ({
    id: a.id,
    adminId: asStr(a.adminId, 'migrated_system'),
    adminEmail: asStr(a.adminEmail),
    action: asStr(a.action),
    targetType: asOptStr(a.targetType),
    targetId: asOptStr(a.targetId),
    summary: asOptStr(a.summary),
    createdAt: toMillis(a.createdAt, now),
  }));

  return {
    users: Array.from(userMap.values()),
    adminRecords,
    userBans,
    businesses,
    marketplaceItems,
    reviews,
    favourites: Array.from(favMap.values()),
    claims,
    reports,
    listingOverrides,
    contactMessages,
    newsletterSubscribers: Array.from(subscriberMap.values()),
    siteSettings,
    auditLog,
    mediaObjects: [],
  };
}

export interface ParameterizedStmt {
  sql: string;
  params: unknown[];
}

export function buildIdempotentImportStatements(dataset: NormalizedD1Dataset): ParameterizedStmt[] {
  const stmts: ParameterizedStmt[] = [];

  for (const u of dataset.users) {
    stmts.push({
      sql: `INSERT INTO user (id, name, email, email_verified, image, role, banned, ban_reason, banned_by, banned_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = CASE WHEN user.name = '' THEN excluded.name ELSE user.name END,
              role = CASE WHEN excluded.role = 'admin' THEN 'admin' ELSE user.role END,
              banned = excluded.banned,
              ban_reason = COALESCE(excluded.ban_reason, user.ban_reason),
              banned_by = COALESCE(excluded.banned_by, user.banned_by),
              banned_at = COALESCE(excluded.banned_at, user.banned_at),
              updated_at = MAX(user.updated_at, excluded.updated_at)`,
      params: [
        u.id,
        u.name,
        u.email,
        u.emailVerified,
        u.image,
        u.role,
        u.banned,
        u.banReason,
        u.bannedBy,
        u.bannedAt,
        u.createdAt,
        u.updatedAt,
      ],
    });
  }

  for (const ar of dataset.adminRecords) {
    stmts.push({
      sql: `INSERT INTO admin_records (user_id, email, added_by, added_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              email = excluded.email,
              added_by = COALESCE(excluded.added_by, admin_records.added_by)`,
      params: [ar.userId, ar.email, ar.addedBy, ar.addedAt],
    });
  }

  for (const b of dataset.userBans) {
    stmts.push({
      sql: `INSERT INTO user_bans (user_id, email, name, reason, banned_by, banned_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              email = excluded.email,
              name = excluded.name,
              reason = excluded.reason,
              banned_by = COALESCE(excluded.banned_by, user_bans.banned_by),
              banned_at = excluded.banned_at`,
      params: [b.userId, b.email, b.name, b.reason, b.bannedBy, b.bannedAt],
    });
  }

  for (const biz of dataset.businesses) {
    stmts.push({
      sql: `INSERT INTO businesses (
              id, owner_id, owner_name, name, category_id, category, state, lga, address, landmark,
              phone, secondary_phone, whatsapp, email, website, google_map_url, logo_url,
              cover_image_url, gallery_json,
              cac_status, cac_number, year_established, price_level,
              payment_methods_json, socials_json, tags_json, opening_hours, description,
              rating, reviews_count, status, is_verified, claimed, claimed_from_seed_id,
              moderation_note, reviewed_by, reviewed_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              owner_name = excluded.owner_name,
              name = excluded.name,
              category_id = excluded.category_id,
              category = excluded.category,
              state = excluded.state,
              lga = excluded.lga,
              address = excluded.address,
              landmark = excluded.landmark,
              phone = excluded.phone,
              secondary_phone = excluded.secondary_phone,
              whatsapp = excluded.whatsapp,
              email = excluded.email,
              website = excluded.website,
              google_map_url = excluded.google_map_url,
              logo_url = excluded.logo_url,
              cover_image_url = excluded.cover_image_url,
              gallery_json = excluded.gallery_json,
              cac_status = excluded.cac_status,
              cac_number = excluded.cac_number,
              year_established = excluded.year_established,
              price_level = excluded.price_level,
              payment_methods_json = excluded.payment_methods_json,
              socials_json = excluded.socials_json,
              tags_json = excluded.tags_json,
              opening_hours = excluded.opening_hours,
              description = excluded.description,
              rating = excluded.rating,
              reviews_count = excluded.reviews_count,
              status = excluded.status,
              is_verified = excluded.is_verified,
              claimed = excluded.claimed,
              claimed_from_seed_id = excluded.claimed_from_seed_id,
              moderation_note = excluded.moderation_note,
              reviewed_by = excluded.reviewed_by,
              reviewed_at = excluded.reviewed_at,
              updated_at = excluded.updated_at`,
      params: [
        biz.id,
        biz.ownerId,
        biz.ownerName,
        biz.name,
        biz.categoryId,
        biz.category,
        biz.state,
        biz.lga,
        biz.address,
        biz.landmark,
        biz.phone,
        biz.secondaryPhone,
        biz.whatsapp,
        biz.email,
        biz.website,
        biz.googleMapUrl,
        biz.logoUrl,
        biz.coverImageUrl,
        biz.galleryJson,
        biz.cacStatus,
        biz.cacNumber,
        biz.yearEstablished,
        biz.priceLevel,
        biz.paymentMethodsJson,
        biz.socialsJson,
        biz.tagsJson,
        biz.openingHours,
        biz.description,
        biz.rating,
        biz.reviewsCount,
        biz.status,
        biz.isVerified,
        biz.claimed,
        biz.claimedFromSeedId,
        biz.moderationNote,
        biz.reviewedBy,
        biz.reviewedAt,
        biz.createdAt,
        biz.updatedAt,
      ],
    });
  }

  for (const ad of dataset.marketplaceItems) {
    stmts.push({
      sql: `INSERT INTO marketplace_items (
              id, owner_id, owner_name, business_id, business_name, category_id,
              title, category, price, is_negotiable, condition, description,
              image_url, additional_images_json, state, lga, location_hub,
              phone, whatsapp, cac_number, featured, views_count,
              status, moderation_note, reviewed_by, reviewed_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              owner_name = excluded.owner_name,
              business_id = excluded.business_id,
              business_name = excluded.business_name,
              category_id = excluded.category_id,
              title = excluded.title,
              category = excluded.category,
              price = excluded.price,
              is_negotiable = excluded.is_negotiable,
              condition = excluded.condition,
              description = excluded.description,
              image_url = excluded.image_url,
              additional_images_json = excluded.additional_images_json,
              state = excluded.state,
              lga = excluded.lga,
              location_hub = excluded.location_hub,
              phone = excluded.phone,
              whatsapp = excluded.whatsapp,
              cac_number = excluded.cac_number,
              featured = excluded.featured,
              views_count = excluded.views_count,
              status = excluded.status,
              moderation_note = excluded.moderation_note,
              reviewed_by = excluded.reviewed_by,
              reviewed_at = excluded.reviewed_at,
              updated_at = excluded.updated_at`,
      params: [
        ad.id,
        ad.ownerId,
        ad.ownerName,
        ad.businessId,
        ad.businessName,
        ad.categoryId,
        ad.title,
        ad.category,
        ad.price,
        ad.isNegotiable,
        ad.condition,
        ad.description,
        ad.imageUrl,
        ad.additionalImagesJson,
        ad.state,
        ad.lga,
        ad.locationHub,
        ad.phone,
        ad.whatsapp,
        ad.cacNumber,
        ad.featured,
        ad.viewsCount,
        ad.status,
        ad.moderationNote,
        ad.reviewedBy,
        ad.reviewedAt,
        ad.createdAt,
        ad.updatedAt,
      ],
    });
  }

  for (const r of dataset.reviews) {
    stmts.push({
      sql: `INSERT INTO reviews (id, business_id, author_id, author_name, rating, comment, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              author_name = excluded.author_name,
              rating = excluded.rating,
              comment = excluded.comment`,
      params: [r.id, r.businessId, r.authorId, r.authorName, r.rating, r.comment, r.createdAt],
    });
  }

  for (const f of dataset.favourites) {
    stmts.push({
      sql: `INSERT INTO favourites (id, user_id, business_id, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, business_id) DO NOTHING`,
      params: [f.id, f.userId, f.businessId, f.createdAt],
    });
  }

  for (const cl of dataset.claims) {
    stmts.push({
      sql: `INSERT INTO claims (
              id, business_id, business_name, claimant_id, name, email, phone, role,
              proof_note, proof_attachment_url, status, review_note, reviewed_by, reviewed_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              proof_attachment_url = COALESCE(excluded.proof_attachment_url, claims.proof_attachment_url),
              status = excluded.status,
              review_note = excluded.review_note,
              reviewed_by = excluded.reviewed_by,
              reviewed_at = excluded.reviewed_at`,
      params: [
        cl.id,
        cl.businessId,
        cl.businessName,
        cl.claimantId,
        cl.name,
        cl.email,
        cl.phone,
        cl.role,
        cl.proofNote,
        cl.proofAttachmentUrl,
        cl.status,
        cl.reviewNote,
        cl.reviewedBy,
        cl.reviewedAt,
        cl.createdAt,
      ],
    });
  }

  for (const rep of dataset.reports) {
    stmts.push({
      sql: `INSERT INTO reports (
              id, target_type, target_id, target_title, reason, details,
              reporter_id, reporter_name, status, resolution, resolved_by, resolved_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              status = excluded.status,
              resolution = excluded.resolution,
              resolved_by = excluded.resolved_by,
              resolved_at = excluded.resolved_at`,
      params: [
        rep.id,
        rep.targetType,
        rep.targetId,
        rep.targetTitle,
        rep.reason,
        rep.details,
        rep.reporterId,
        rep.reporterName,
        rep.status,
        rep.resolution,
        rep.resolvedBy,
        rep.resolvedAt,
        rep.createdAt,
      ],
    });
  }

  for (const ovr of dataset.listingOverrides) {
    stmts.push({
      sql: `INSERT INTO listing_overrides (id, kind, listing_id, hidden, verified, claimed_by, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              hidden = excluded.hidden,
              verified = excluded.verified,
              claimed_by = excluded.claimed_by,
              updated_by = excluded.updated_by,
              updated_at = excluded.updated_at`,
      params: [
        ovr.id,
        ovr.kind,
        ovr.listingId,
        ovr.hidden,
        ovr.verified,
        ovr.claimedBy,
        ovr.updatedBy,
        ovr.updatedAt,
      ],
    });
  }

  for (const m of dataset.contactMessages) {
    stmts.push({
      sql: `INSERT INTO contact_messages (id, uid, name, email, subject, message, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              status = excluded.status`,
      params: [m.id, m.uid, m.name, m.email, m.subject, m.message, m.status, m.createdAt],
    });
  }

  for (const sub of dataset.newsletterSubscribers) {
    stmts.push({
      sql: `INSERT INTO newsletter_subscribers (email, source, status, subscribed_at, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
              source = excluded.source,
              status = excluded.status`,
      params: [sub.email, sub.source, sub.status, sub.subscribedAt, sub.createdAt],
    });
  }

  for (const st of dataset.siteSettings) {
    stmts.push({
      sql: `INSERT INTO site_settings (
              id, contact_email, contact_phone, whatsapp, address, office_hours,
              about_story, announcement_enabled, announcement_text, ads_need_approval,
              updated_at, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              contact_email = excluded.contact_email,
              contact_phone = excluded.contact_phone,
              whatsapp = excluded.whatsapp,
              address = excluded.address,
              office_hours = excluded.office_hours,
              about_story = excluded.about_story,
              announcement_enabled = excluded.announcement_enabled,
              announcement_text = excluded.announcement_text,
              ads_need_approval = excluded.ads_need_approval,
              updated_at = excluded.updated_at,
              updated_by = excluded.updated_by`,
      params: [
        st.id,
        st.contactEmail,
        st.contactPhone,
        st.whatsapp,
        st.address,
        st.officeHours,
        st.aboutStory,
        st.announcementEnabled,
        st.announcementText,
        st.adsNeedApproval,
        st.updatedAt,
        st.updatedBy,
      ],
    });
  }

  for (const aud of dataset.auditLog) {
    stmts.push({
      sql: `INSERT INTO audit_log (id, admin_id, admin_email, action, target_type, target_id, summary, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING`,
      params: [
        aud.id,
        aud.adminId,
        aud.adminEmail,
        aud.action,
        aud.targetType,
        aud.targetId,
        aud.summary,
        aud.createdAt,
      ],
    });
  }

  for (const mo of dataset.mediaObjects ?? []) {
    stmts.push({
      sql: `INSERT INTO media_objects (
              key, owner_id, purpose, entity_type, entity_id, visibility,
              content_type, size_bytes, sha256, original_filename, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              entity_type = COALESCE(excluded.entity_type, media_objects.entity_type),
              entity_id = COALESCE(excluded.entity_id, media_objects.entity_id),
              updated_at = MAX(media_objects.updated_at, excluded.updated_at)`,
      params: [
        mo.key,
        mo.ownerId,
        mo.purpose,
        mo.entityType,
        mo.entityId,
        mo.visibility,
        mo.contentType,
        mo.sizeBytes,
        mo.sha256,
        mo.originalFilename,
        mo.createdAt,
        mo.updatedAt,
      ],
    });
  }

  return stmts;
}

export async function importDatasetToD1(db: D1Database, dataset: NormalizedD1Dataset) {
  const stmts = buildIdempotentImportStatements(dataset);
  const prepared = stmts.map((s) => db.prepare(s.sql).bind(...s.params));
  const CHUNK = 50;
  for (let i = 0; i < prepared.length; i += CHUNK) {
    await db.batch(prepared.slice(i, i + CHUNK));
  }
  return { statementsExecuted: stmts.length };
}

function sqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : '0';
  if (typeof val === 'boolean') return val ? '1' : '0';
  const str = String(val).replace(/'/g, "''");
  return `'${str}'`;
}

export function renderSqlFile(dataset: NormalizedD1Dataset): string {
  const stmts = buildIdempotentImportStatements(dataset);
  const lines = [
    '-- Auto-generated idempotent NaijaPages Firestore -> D1 import SQL',
    'PRAGMA foreign_keys = ON;',
  ];
  for (const s of stmts) {
    let idx = 0;
    const rendered = s.sql.replace(/\?/g, () => sqlLiteral(s.params[idx++]));
    lines.push(`${rendered.replace(/\s+/g, ' ').trim()};`);
  }
  return `${lines.join('\n')}\n`;
}

export interface IntegrityReport {
  ok: boolean;
  counts: Record<string, number>;
  issues: string[];
}

export async function verifyD1Integrity(
  db: D1Database,
  expectedDataset?: NormalizedD1Dataset,
): Promise<IntegrityReport> {
  const issues: string[] = [];

  const tableNames = [
    'user',
    'admin_records',
    'user_bans',
    'categories',
    'businesses',
    'marketplace_items',
    'reviews',
    'favourites',
    'claims',
    'reports',
    'listing_overrides',
    'contact_messages',
    'newsletter_subscribers',
    'site_settings',
    'audit_log',
    'media_objects',
  ] as const;

  const counts: Record<string, number> = {};
  for (const tbl of tableNames) {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${tbl}`).first<{ count: number }>();
    counts[tbl] = Number(row?.count ?? 0);
  }

  if (counts.categories < 20) {
    issues.push(`Expected at least 20 seeded categories, found ${counts.categories}.`);
  }
  if (counts.site_settings < 1) {
    issues.push('Missing default site_settings row.');
  }

  if (expectedDataset) {
    const expected: Record<string, number> = {
      user: expectedDataset.users.length,
      admin_records: expectedDataset.adminRecords.length,
      user_bans: expectedDataset.userBans.length,
      businesses: expectedDataset.businesses.length,
      marketplace_items: expectedDataset.marketplaceItems.length,
      reviews: expectedDataset.reviews.length,
      favourites: expectedDataset.favourites.length,
      claims: expectedDataset.claims.length,
      reports: expectedDataset.reports.length,
      listing_overrides: expectedDataset.listingOverrides.length,
      contact_messages: expectedDataset.contactMessages.length,
      newsletter_subscribers: expectedDataset.newsletterSubscribers.length,
      audit_log: expectedDataset.auditLog.length,
    };
    for (const [tbl, minCount] of Object.entries(expected)) {
      if (counts[tbl] < minCount) {
        issues.push(`Record count mismatch on ${tbl}: expected >= ${minCount}, found ${counts[tbl]}.`);
      }
    }
  }

  // Referential & parity checks
  const checks: Array<{ name: string; sql: string }> = [
    {
      name: 'orphan businesses.owner_id',
      sql: 'SELECT COUNT(*) AS count FROM businesses b LEFT JOIN user u ON u.id = b.owner_id WHERE u.id IS NULL',
    },
    {
      name: 'orphan businesses.category_id',
      sql: 'SELECT COUNT(*) AS count FROM businesses b LEFT JOIN categories c ON c.id = b.category_id WHERE b.category_id IS NOT NULL AND c.id IS NULL',
    },
    {
      name: 'orphan marketplace_items.owner_id',
      sql: 'SELECT COUNT(*) AS count FROM marketplace_items m LEFT JOIN user u ON u.id = m.owner_id WHERE u.id IS NULL',
    },
    {
      name: 'orphan marketplace_items.business_id',
      sql: 'SELECT COUNT(*) AS count FROM marketplace_items m LEFT JOIN businesses b ON b.id = m.business_id WHERE m.business_id IS NOT NULL AND b.id IS NULL',
    },
    {
      name: 'orphan reviews.author_id',
      sql: 'SELECT COUNT(*) AS count FROM reviews r LEFT JOIN user u ON u.id = r.author_id WHERE u.id IS NULL',
    },
    {
      name: 'orphan favourites.user_id',
      sql: 'SELECT COUNT(*) AS count FROM favourites f LEFT JOIN user u ON u.id = f.user_id WHERE u.id IS NULL',
    },
    {
      name: 'orphan claims.claimant_id',
      sql: 'SELECT COUNT(*) AS count FROM claims cl LEFT JOIN user u ON u.id = cl.claimant_id WHERE u.id IS NULL',
    },
    {
      name: 'orphan reports.reporter_id',
      sql: 'SELECT COUNT(*) AS count FROM reports rep LEFT JOIN user u ON u.id = rep.reporter_id WHERE u.id IS NULL',
    },
    {
      name: 'admin_records / user.role parity',
      sql: "SELECT COUNT(*) AS count FROM admin_records ar LEFT JOIN user u ON u.id = ar.user_id WHERE u.id IS NULL OR u.role != 'admin'",
    },
    {
      name: 'user_bans / user.banned parity',
      sql: 'SELECT COUNT(*) AS count FROM user_bans ub LEFT JOIN user u ON u.id = ub.user_id WHERE u.id IS NULL OR u.banned != 1',
    },
    {
      name: 'orphan media_objects.owner_id',
      sql: 'SELECT COUNT(*) AS count FROM media_objects mo LEFT JOIN user u ON u.id = mo.owner_id WHERE u.id IS NULL',
    },
    {
      name: 'business rating/reviewsCount consistency',
      sql: `SELECT COUNT(*) AS count FROM businesses b
            WHERE b.reviews_count != (SELECT COUNT(*) FROM reviews r WHERE r.business_id = b.id)
               OR ABS(b.rating - COALESCE((SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.business_id = b.id), 0)) > 0.05`,
    },
  ];

  for (const check of checks) {
    const row = await db.prepare(check.sql).first<{ count: number }>();
    const bad = Number(row?.count ?? 0);
    if (bad > 0) {
      issues.push(`Integrity check failed (${check.name}): ${bad} inconsistent row(s).`);
    }
  }

  return {
    ok: issues.length === 0,
    counts,
    issues,
  };
}

export function isFirebaseStorageUrl(rawUrl: unknown): boolean {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('gs://')) return true;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'firebasestorage.googleapis.com' ||
      host.endsWith('.firebasestorage.app') ||
      (host === 'storage.googleapis.com' && parsed.pathname.includes('.appspot.com')) ||
      (host === 'storage.googleapis.com' && parsed.pathname.includes('.firebasestorage.app'))
    );
  } catch {
    return false;
  }
}

export function resolveFirebaseDownloadUrl(rawUrl: string): {
  downloadUrl: string;
  originalFilename: string | null;
} | null {
  const trimmed = rawUrl.trim();
  if (!isFirebaseStorageUrl(trimmed)) return null;

  if (trimmed.startsWith('gs://')) {
    const withoutScheme = trimmed.slice('gs://'.length);
    const slashIdx = withoutScheme.indexOf('/');
    if (slashIdx <= 0) return null;
    const bucket = withoutScheme.slice(0, slashIdx);
    const objectPath = withoutScheme.slice(slashIdx + 1);
    if (!objectPath) return null;
    const filename = objectPath.split('/').pop() || null;
    return {
      downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}?alt=media`,
      originalFilename: filename,
    };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.toLowerCase() === 'firebasestorage.googleapis.com') {
      if (!parsed.searchParams.has('alt')) {
        parsed.searchParams.set('alt', 'media');
      }
      const encodedObj = parsed.pathname.split('/o/')[1] ?? '';
      const decodedPath = encodedObj ? decodeURIComponent(encodedObj) : '';
      return {
        downloadUrl: parsed.href,
        originalFilename: decodedPath.split('/').pop() || null,
      };
    }
    return {
      downloadUrl: parsed.href,
      originalFilename: parsed.pathname.split('/').pop() || null,
    };
  } catch {
    return null;
  }
}

export interface StorageMigrationSummary {
  scannedRefs: number;
  migratedCount: number;
  reusedCount: number;
  skippedCount: number;
  failedCount: number;
  failures: Array<{ sourceUrl: string; reason: string }>;
}

export async function migrateDatasetMediaToR2(
  dataset: NormalizedD1Dataset,
  opts: {
    bucket: R2Bucket;
    fetcher?: typeof fetch;
    publicBaseUrl?: string | null;
    nowMs?: number;
  },
): Promise<StorageMigrationSummary> {
  const fetcher = opts.fetcher ?? globalThis.fetch;
  const now = opts.nowMs ?? Date.now();
  const migratedByUrl = new Map<string, string>();
  const mediaObjects = [...(dataset.mediaObjects ?? [])];
  const existingKeys = new Set(mediaObjects.map((m) => m.key));

  const summary: StorageMigrationSummary = {
    scannedRefs: 0,
    migratedCount: 0,
    reusedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    failures: [],
  };

  async function migrateOne(
    rawUrl: string | null,
    meta: {
      ownerId: string;
      purpose: MediaPurpose;
      entityType: MediaEntityType;
      entityId: string;
    },
  ): Promise<string | null> {
    if (!rawUrl || !isFirebaseStorageUrl(rawUrl)) {
      return rawUrl;
    }
    summary.scannedRefs += 1;

    const cached = migratedByUrl.get(rawUrl);
    if (cached) {
      summary.reusedCount += 1;
      return cached;
    }

    const resolved = resolveFirebaseDownloadUrl(rawUrl);
    if (!resolved) {
      summary.failedCount += 1;
      summary.failures.push({ sourceUrl: rawUrl, reason: 'Unrecognized Firebase Storage URL format.' });
      return rawUrl;
    }

    try {
      const res = await fetcher(resolved.downloadUrl, { method: 'GET' });
      if (!res.ok) {
        summary.failedCount += 1;
        summary.failures.push({
          sourceUrl: rawUrl,
          reason: `Download failed with HTTP ${res.status}.`,
        });
        return rawUrl;
      }

      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes.byteLength <= 0) {
        summary.failedCount += 1;
        summary.failures.push({ sourceUrl: rawUrl, reason: 'Downloaded object is empty.' });
        return rawUrl;
      }

      const maxBytes = MAX_SIZE_BYTES_BY_PURPOSE[meta.purpose];
      if (bytes.byteLength > maxBytes) {
        summary.failedCount += 1;
        summary.failures.push({
          sourceUrl: rawUrl,
          reason: `Object exceeds max allowed size (${bytes.byteLength} > ${maxBytes}).`,
        });
        return rawUrl;
      }

      const magicMime = detectMagicMimeType(bytes);
      const allowed = allowedMimeTypesForPurpose(meta.purpose);
      if (!magicMime || !allowed.has(magicMime)) {
        summary.failedCount += 1;
        summary.failures.push({
          sourceUrl: rawUrl,
          reason: `Unsupported or unrecognized file signature (${magicMime ?? 'unknown'}).`,
        });
        return rawUrl;
      }

      const visibility = defaultVisibilityForPurpose(meta.purpose);
      const key = buildUniqueMediaKey({
        purpose: meta.purpose,
        visibility,
        ownerId: meta.ownerId,
        contentType: magicMime,
        nowMs: now,
      });
      const sha256 = await sha256Hex(buf);
      const cacheControl =
        visibility === 'private' ? 'private, no-store' : 'public, max-age=31536000, immutable';

      await opts.bucket.put(key, buf, {
        httpMetadata: {
          contentType: magicMime,
          cacheControl,
        },
        customMetadata: {
          ownerId: meta.ownerId,
          purpose: meta.purpose,
          visibility,
          migratedFrom: rawUrl.slice(0, 200),
        },
      });

      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        mediaObjects.push({
          key,
          ownerId: meta.ownerId,
          purpose: meta.purpose,
          entityType: meta.entityType,
          entityId: meta.entityId,
          visibility,
          contentType: magicMime,
          sizeBytes: bytes.byteLength,
          sha256,
          originalFilename: resolved.originalFilename,
          createdAt: now,
          updatedAt: now,
        });
      }

      const deliveryUrl = buildMediaDeliveryUrl(key, visibility, opts.publicBaseUrl);
      migratedByUrl.set(rawUrl, deliveryUrl);
      summary.migratedCount += 1;
      return deliveryUrl;
    } catch (err) {
      summary.failedCount += 1;
      summary.failures.push({
        sourceUrl: rawUrl,
        reason: err instanceof Error ? err.message : 'Unexpected fetch/put failure.',
      });
      return rawUrl;
    }
  }

  for (const u of dataset.users) {
    if (u.image) {
      if (!isFirebaseStorageUrl(u.image)) summary.skippedCount += 1;
      else u.image = await migrateOne(u.image, { ownerId: u.id, purpose: 'avatar', entityType: 'user', entityId: u.id });
    }
  }

  for (const b of dataset.businesses) {
    if (b.logoUrl) {
      if (!isFirebaseStorageUrl(b.logoUrl)) summary.skippedCount += 1;
      else b.logoUrl = await migrateOne(b.logoUrl, { ownerId: b.ownerId, purpose: 'business_logo', entityType: 'business', entityId: b.id });
    }
    if (b.coverImageUrl) {
      if (!isFirebaseStorageUrl(b.coverImageUrl)) summary.skippedCount += 1;
      else b.coverImageUrl = await migrateOne(b.coverImageUrl, { ownerId: b.ownerId, purpose: 'business_photo', entityType: 'business', entityId: b.id });
    }
    try {
      const gallery = JSON.parse(b.galleryJson) as unknown[];
      if (Array.isArray(gallery) && gallery.length > 0) {
        const nextGallery: string[] = [];
        for (const item of gallery) {
          if (typeof item !== 'string') continue;
          if (!isFirebaseStorageUrl(item)) {
            summary.skippedCount += 1;
            nextGallery.push(item);
          } else {
            const migrated = await migrateOne(item, {
              ownerId: b.ownerId,
              purpose: 'business_gallery',
              entityType: 'business',
              entityId: b.id,
            });
            if (migrated) nextGallery.push(migrated);
          }
        }
        b.galleryJson = JSON.stringify(nextGallery);
      }
    } catch {
      // keep existing galleryJson if malformed
    }
  }

  for (const ad of dataset.marketplaceItems) {
    if (ad.imageUrl) {
      if (!isFirebaseStorageUrl(ad.imageUrl)) summary.skippedCount += 1;
      else {
        ad.imageUrl =
          (await migrateOne(ad.imageUrl, {
            ownerId: ad.ownerId,
            purpose: 'marketplace_image',
            entityType: 'marketplace_item',
            entityId: ad.id,
          })) ?? ad.imageUrl;
      }
    }
    try {
      const extras = JSON.parse(ad.additionalImagesJson) as unknown[];
      if (Array.isArray(extras) && extras.length > 0) {
        const nextExtras: string[] = [];
        for (const item of extras) {
          if (typeof item !== 'string') continue;
          if (!isFirebaseStorageUrl(item)) {
            summary.skippedCount += 1;
            nextExtras.push(item);
          } else {
            const migrated = await migrateOne(item, {
              ownerId: ad.ownerId,
              purpose: 'marketplace_image',
              entityType: 'marketplace_item',
              entityId: ad.id,
            });
            if (migrated) nextExtras.push(migrated);
          }
        }
        ad.additionalImagesJson = JSON.stringify(nextExtras);
      }
    } catch {
      // keep existing additionalImagesJson
    }
  }

  for (const cl of dataset.claims) {
    if (cl.proofAttachmentUrl) {
      if (!isFirebaseStorageUrl(cl.proofAttachmentUrl)) summary.skippedCount += 1;
      else {
        cl.proofAttachmentUrl = await migrateOne(cl.proofAttachmentUrl, {
          ownerId: cl.claimantId,
          purpose: 'claim_proof',
          entityType: 'claim',
          entityId: cl.id,
        });
      }
    }
  }

  dataset.mediaObjects = mediaObjects;
  return summary;
}

export async function findRemainingFirebaseStorageRefs(db: D1Database): Promise<{
  total: number;
  byColumn: Record<string, number>;
}> {
  const queries: Array<{ key: string; sql: string }> = [
    {
      key: 'user.image',
      sql: "SELECT COUNT(*) AS count FROM user WHERE image LIKE '%firebasestorage%' OR image LIKE 'gs://%'",
    },
    {
      key: 'businesses.logo_url',
      sql: "SELECT COUNT(*) AS count FROM businesses WHERE logo_url LIKE '%firebasestorage%' OR logo_url LIKE 'gs://%'",
    },
    {
      key: 'businesses.cover_image_url',
      sql: "SELECT COUNT(*) AS count FROM businesses WHERE cover_image_url LIKE '%firebasestorage%' OR cover_image_url LIKE 'gs://%'",
    },
    {
      key: 'businesses.gallery_json',
      sql: "SELECT COUNT(*) AS count FROM businesses WHERE gallery_json LIKE '%firebasestorage%' OR gallery_json LIKE '%gs://%'",
    },
    {
      key: 'marketplace_items.image_url',
      sql: "SELECT COUNT(*) AS count FROM marketplace_items WHERE image_url LIKE '%firebasestorage%' OR image_url LIKE 'gs://%'",
    },
    {
      key: 'marketplace_items.additional_images_json',
      sql: "SELECT COUNT(*) AS count FROM marketplace_items WHERE additional_images_json LIKE '%firebasestorage%' OR additional_images_json LIKE '%gs://%'",
    },
    {
      key: 'claims.proof_attachment_url',
      sql: "SELECT COUNT(*) AS count FROM claims WHERE proof_attachment_url LIKE '%firebasestorage%' OR proof_attachment_url LIKE 'gs://%'",
    },
  ];

  const byColumn: Record<string, number> = {};
  let total = 0;
  for (const q of queries) {
    const row = await db.prepare(q.sql).first<{ count: number }>();
    const count = Number(row?.count ?? 0);
    byColumn[q.key] = count;
    total += count;
  }

  return { total, byColumn };
}
