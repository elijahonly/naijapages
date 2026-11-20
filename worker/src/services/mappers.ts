import {
  cleanEmail,
  cleanMultiline,
  cleanText,
  LIMITS,
  parseJsonArray,
  parseJsonRecord,
  safeGoogleMapsUrl,
  safeHttpUrl,
  safeMediaUrl,
  safeSocialUrl,
} from '../lib/validation';

export const FALLBACK_AD_IMAGE =
  'https://images.unsplash.com/photo-1526738549149-8e07eca6c147?w=800&auto=format&fit=crop&q=80';

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
  return new Date(ms).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export interface BusinessDbRow {
  id: string;
  owner_id: string;
  owner_name: string;
  name: string;
  category: string;
  category_id: string | null;
  state: string;
  lga: string;
  address: string;
  landmark: string | null;
  phone: string;
  secondary_phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  google_map_url: string;
  logo_url: string | null;
  cover_image_url?: string | null;
  gallery_json?: string | null;
  cac_status: string | null;
  cac_number: string | null;
  year_established: number | null;
  price_level: string | null;
  payment_methods_json: string;
  socials_json: string;
  tags_json: string;
  opening_hours: string | null;
  description: string | null;
  rating: number;
  reviews_count: number;
  status: string;
  is_verified: number;
  claimed: number;
  claimed_from_seed_id: string | null;
  moderation_note: string | null;
  reviewed_by: string | null;
  reviewed_at: number | null;
  origin_type?: string | null;
  verification_tier?: string | null;
  source_attribution?: string | null;
  source_licence_url?: string | null;
  discovered_business_id?: string | null;
  created_at: number;
  updated_at: number;
}

export interface PublishedDiscoveredBusinessDbRow {
  id: string;
  name: string;
  category: string | null;
  state: string | null;
  lga: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  opening_hours: string | null;
  latitude: number | null;
  longitude: number | null;
  source_id: string;
  source_url: string | null;
  verification_tier: string | null;
  lifecycle_status: string | null;
  review_status: string;
  attribution_text: string | null;
  source_licence_url: string | null;
  created_at: number;
  updated_at: number;
}

export interface MarketplaceDbRow {
  id: string;
  owner_id: string;
  owner_name: string;
  business_id: string | null;
  business_name: string;
  title: string;
  category: string;
  category_id: string | null;
  price: number;
  is_negotiable: number;
  condition: string;
  description: string;
  image_url: string;
  additional_images_json: string;
  state: string;
  lga: string;
  location_hub: string | null;
  phone: string;
  whatsapp: string | null;
  cac_number: string | null;
  featured: number;
  views_count: number;
  status: string;
  moderation_note: string | null;
  reviewed_by: string | null;
  reviewed_at: number | null;
  created_at: number;
  updated_at: number;
  linked_business_verified?: number | null;
}

export interface ReviewDbRow {
  id: string;
  business_id: string;
  author_id: string;
  author_name: string;
  rating: number;
  comment: string;
  created_at: number;
}

export interface ClaimDbRow {
  id: string;
  business_id: string;
  business_name: string;
  claimant_id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  proof_note: string | null;
  proof_attachment_url?: string | null;
  status: string;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: number | null;
  created_at: number;
}

export interface ReportDbRow {
  id: string;
  target_type: string;
  target_id: string;
  target_title: string;
  reason: string;
  details: string | null;
  reporter_id: string;
  reporter_name: string | null;
  status: string;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: number | null;
  created_at: number;
}

export interface OverrideDbRow {
  id: string;
  kind: string;
  listing_id: string;
  hidden: number;
  verified: number;
  claimed_by: string | null;
  updated_by: string | null;
  updated_at: number;
}

export interface SettingsDbRow {
  id: string;
  contact_email: string;
  contact_phone: string;
  whatsapp: string;
  address: string;
  office_hours: string;
  about_story: string;
  announcement_enabled: number;
  announcement_text: string;
  ads_need_approval: number;
  updated_by: string | null;
  updated_at: number;
}

export interface CategoryDbRow {
  id: string;
  kind: string;
  key: string;
  label: string;
  emoji: string;
  sort_order: number;
  is_active: number;
}

export function mapBusinessRow(r: BusinessDbRow) {
  const rawSocials = parseJsonRecord(r.socials_json);
  const socials: Record<string, string> = {};
  for (const key of ['instagram', 'twitter', 'facebook', 'linkedin', 'tiktok'] as const) {
    const val = safeSocialUrl(key, rawSocials[key]);
    if (val) socials[key] = val;
  }
  const paymentMethods = parseJsonArray(r.payment_methods_json)
    .map((p) => cleanText(p, 40))
    .filter(Boolean);
  const tags = parseJsonArray(r.tags_json)
    .map((t) => cleanText(t, 40))
    .filter(Boolean);
  const gallery = parseJsonArray(r.gallery_json)
    .map((u) => safeMediaUrl(u, { max: 600 }))
    .filter((u): u is string => Boolean(u));
  const logoUrl = r.logo_url ? safeMediaUrl(r.logo_url, { max: 600 }) : undefined;
  const coverImageUrl = r.cover_image_url ? safeMediaUrl(r.cover_image_url, { max: 600 }) : undefined;

  return {
    id: r.id,
    name: cleanText(r.name, LIMITS.name),
    category: cleanText(r.category, LIMITS.category),
    categoryId: r.category_id || undefined,
    state: cleanText(r.state, LIMITS.state),
    lga: cleanText(r.lga, LIMITS.lga),
    address: cleanText(r.address, LIMITS.address),
    landmark: r.landmark ? cleanText(r.landmark, LIMITS.landmark) || undefined : undefined,
    phone: cleanText(r.phone, LIMITS.phone),
    secondaryPhone: r.secondary_phone
      ? cleanText(r.secondary_phone, LIMITS.phone) || undefined
      : undefined,
    whatsapp: r.whatsapp ? cleanText(r.whatsapp, LIMITS.phone) || undefined : undefined,
    email: r.email ? cleanEmail(r.email) : undefined,
    website: r.website ? safeHttpUrl(r.website, { max: LIMITS.url }) : undefined,
    googleMapUrl: safeGoogleMapsUrl(r.google_map_url),
    logoUrl,
    coverImageUrl,
    gallery: gallery.length ? gallery : undefined,
    cacStatus:
      r.cac_status && ['registered', 'pending', 'unregistered'].includes(r.cac_status)
        ? (r.cac_status as 'registered' | 'pending' | 'unregistered')
        : undefined,
    cacNumber: r.cac_number ? cleanText(r.cac_number, LIMITS.cac) || undefined : undefined,
    yearEstablished: Number.isInteger(r.year_established) ? Number(r.year_established) : undefined,
    priceLevel:
      r.price_level && ['₦', '₦₦', '₦₦₦', '₦₦₦₦'].includes(r.price_level)
        ? (r.price_level as '₦' | '₦₦' | '₦₦₦' | '₦₦₦₦')
        : undefined,
    paymentMethods: paymentMethods.length ? paymentMethods : undefined,
    tags: tags.length ? tags : undefined,
    openingHours: r.opening_hours ? cleanText(r.opening_hours, LIMITS.hours) || undefined : undefined,
    description: r.description
      ? cleanMultiline(r.description, LIMITS.description) || undefined
      : undefined,
    socials: Object.keys(socials).length ? socials : undefined,
    rating: Number(r.rating) || 0,
    reviewsCount: Number(r.reviews_count) || 0,
    isVerified: r.is_verified === 1,
    isUserAdded: true,
    claimed: r.claimed === 1,
    ownerId: r.owner_id,
    ownerName: cleanText(r.owner_name, LIMITS.displayName) || undefined,
    status: r.status as 'pending' | 'approved' | 'rejected' | 'removed',
    moderationNote: r.moderation_note ? cleanText(r.moderation_note, 500) || undefined : undefined,
    originType: (r.origin_type as 'member_submitted' | 'bot_discovered' | 'owner_claimed') || 'member_submitted',
    verificationTier:
      (r.verification_tier as
        | 'discovered'
        | 'evidence_checked'
        | 'listing_verified'
        | 'owner_verified'
        | 'registry_corroborated') || (r.is_verified === 1 ? 'owner_verified' : undefined),
    sourceAttribution: r.source_attribution ? cleanText(r.source_attribution, 200) || undefined : undefined,
    sourceLicenceUrl: r.source_licence_url ? safeHttpUrl(r.source_licence_url, { max: 300 }) : undefined,
    createdAt: Number(r.created_at) || undefined,
  };
}

/**
 * Maps an approved & published `discovered_businesses` staging row into the public `Business`
 * shape without fabricating phone numbers, ratings, reviews, or Owner Verified badges.
 */
export function mapPublishedDiscoveredBusinessRow(r: PublishedDiscoveredBusinessDbRow) {
  const tier =
    (r.verification_tier as
      | 'discovered'
      | 'evidence_checked'
      | 'listing_verified'
      | 'owner_verified'
      | 'registry_corroborated') || 'discovered';
  const mapUrl =
    typeof r.latitude === 'number' &&
    typeof r.longitude === 'number' &&
    Number.isFinite(r.latitude) &&
    Number.isFinite(r.longitude)
      ? `https://www.google.com/maps/search/?api=1&query=${r.latitude},${r.longitude}`
      : undefined;

  return {
    id: r.id,
    name: cleanText(r.name, LIMITS.name),
    category: cleanText(r.category || 'Other', LIMITS.category) || 'Other',
    categoryId: undefined,
    state: cleanText(r.state || 'Nigeria', LIMITS.state) || 'Nigeria',
    lga: cleanText(r.lga || '', LIMITS.lga),
    address: cleanText(r.address || '', LIMITS.address),
    landmark: undefined,
    phone: r.phone ? cleanText(r.phone, LIMITS.phone) : '',
    secondaryPhone: undefined,
    whatsapp: undefined,
    email: r.email ? cleanEmail(r.email) : undefined,
    website: r.website ? safeHttpUrl(r.website, { max: LIMITS.url }) : undefined,
    googleMapUrl: mapUrl ? safeGoogleMapsUrl(mapUrl) : undefined,
    logoUrl: undefined,
    coverImageUrl: undefined,
    gallery: undefined,
    cacStatus: undefined,
    cacNumber: undefined,
    yearEstablished: undefined,
    priceLevel: undefined,
    paymentMethods: undefined,
    tags: undefined,
    openingHours: r.opening_hours ? cleanText(r.opening_hours, LIMITS.hours) || undefined : undefined,
    description: undefined,
    socials: undefined,
    rating: 0,
    reviewsCount: 0,
    // Strictly never award Owner Verified badge automatically to bot-discovered records.
    isVerified: tier === 'owner_verified',
    isUserAdded: false,
    claimed: false,
    ownerId: undefined,
    ownerName: undefined,
    status: 'approved' as const,
    moderationNote: undefined,
    originType: 'bot_discovered' as const,
    verificationTier: tier,
    sourceAttribution: r.attribution_text ? cleanText(r.attribution_text, 200) || undefined : undefined,
    sourceLicenceUrl: r.source_licence_url ? safeHttpUrl(r.source_licence_url, { max: 300 }) : undefined,
    createdAt: Number(r.created_at) || undefined,
  };
}

export function mapMarketplaceRow(r: MarketplaceDbRow) {
  const createdAt = Number(r.created_at) || undefined;
  const extra = parseJsonArray(r.additional_images_json)
    .map((u) => safeMediaUrl(u, { max: 600 }))
    .filter((u): u is string => Boolean(u));

  return {
    id: r.id,
    businessId: r.business_id || undefined,
    businessName: cleanText(r.business_name, LIMITS.name),
    title: cleanText(r.title, LIMITS.title),
    category: r.category,
    categoryId: r.category_id || undefined,
    price: Number(r.price) || 0,
    isNegotiable: r.is_negotiable === 1,
    condition: r.condition,
    description: cleanMultiline(r.description, LIMITS.description),
    imageUrl: safeMediaUrl(r.image_url, { max: 600 }) ?? FALLBACK_AD_IMAGE,
    additionalImages: extra.length ? extra : undefined,
    state: cleanText(r.state, LIMITS.state),
    lga: cleanText(r.lga, LIMITS.lga),
    locationHub: r.location_hub ? cleanText(r.location_hub, LIMITS.locationHub) || undefined : undefined,
    phone: cleanText(r.phone, LIMITS.phone),
    whatsapp: r.whatsapp ? cleanText(r.whatsapp, LIMITS.phone) || undefined : undefined,
    isVerifiedSeller: r.linked_business_verified === 1,
    cacNumber: r.cac_number ? cleanText(r.cac_number, LIMITS.cac) || undefined : undefined,
    featured: false,
    viewsCount: Number(r.views_count) || 0,
    postedDate: timeAgo(createdAt),
    ownerId: r.owner_id,
    ownerName: cleanText(r.owner_name, LIMITS.displayName) || undefined,
    status: r.status as 'pending' | 'active' | 'removed',
    moderationNote: r.moderation_note ? cleanText(r.moderation_note, 500) || undefined : undefined,
    createdAt,
  };
}

export function mapReviewRow(r: ReviewDbRow) {
  const createdAt = Number(r.created_at) || undefined;
  return {
    id: r.id,
    businessId: r.business_id,
    author: cleanText(r.author_name, LIMITS.displayName) || 'Member',
    authorId: r.author_id,
    rating: Math.min(5, Math.max(1, Math.round(Number(r.rating) || 1))),
    comment: cleanMultiline(r.comment, LIMITS.review),
    date: timeAgo(createdAt),
    createdAt,
  };
}

export function mapClaimRow(r: ClaimDbRow) {
  return {
    id: r.id,
    businessId: r.business_id,
    businessName: cleanText(r.business_name, 150),
    claimantId: r.claimant_id,
    name: cleanText(r.name, 100),
    email: cleanText(r.email, 150),
    phone: cleanText(r.phone, LIMITS.phone),
    role: cleanText(r.role, 60),
    proofNote: r.proof_note ? cleanMultiline(r.proof_note, 1000) || undefined : undefined,
    proofAttachmentUrl: r.proof_attachment_url
      ? safeMediaUrl(r.proof_attachment_url, { max: 600, allowPrivate: true })
      : undefined,
    status: r.status as 'pending' | 'approved' | 'rejected',
    createdAt: Number(r.created_at) || undefined,
    reviewedBy: r.reviewed_by || undefined,
    reviewedAt: r.reviewed_at ? Number(r.reviewed_at) : undefined,
    reviewNote: r.review_note ? cleanText(r.review_note, 500) || undefined : undefined,
  };
}

export function mapReportRow(r: ReportDbRow) {
  return {
    id: r.id,
    targetType: r.target_type as 'business' | 'ad' | 'review',
    targetId: cleanText(r.target_id, 300),
    targetTitle: cleanText(r.target_title, 150),
    reason: r.reason,
    details: r.details ? cleanMultiline(r.details, LIMITS.reportDetails) || undefined : undefined,
    reporterId: cleanText(r.reporter_id, 128),
    reporterName: r.reporter_name ? cleanText(r.reporter_name, 100) || undefined : undefined,
    status: (r.status === 'resolved' || r.status === 'dismissed' ? r.status : 'open') as
      | 'open'
      | 'resolved'
      | 'dismissed',
    createdAt: Number(r.created_at) || undefined,
    resolution: r.resolution ? cleanText(r.resolution, 500) || undefined : undefined,
    resolvedBy: r.resolved_by || undefined,
    resolvedAt: r.resolved_at ? Number(r.resolved_at) : undefined,
  };
}

export function mapOverrideRow(r: OverrideDbRow) {
  const kind = r.kind === 'marketplace' ? 'marketplace' : 'business';
  return {
    id: r.listing_id,
    kind: kind as 'business' | 'marketplace',
    hidden: r.hidden === 1,
    verified: r.verified === 1,
    claimedBy: r.claimed_by || undefined,
  };
}

export function mapSettingsRow(r: SettingsDbRow | null) {
  if (!r) {
    return {
      contactEmail: '',
      contactPhone: '',
      whatsapp: '',
      address: '',
      officeHours: '',
      aboutStory: '',
      announcementEnabled: false,
      announcementText: '',
      adsNeedApproval: false,
    };
  }
  return {
    contactEmail: cleanText(r.contact_email, 150),
    contactPhone: cleanText(r.contact_phone, 40),
    whatsapp: cleanText(r.whatsapp, 40),
    address: cleanText(r.address, 300),
    officeHours: cleanText(r.office_hours, 200),
    aboutStory: cleanMultiline(r.about_story, 5000),
    announcementEnabled: r.announcement_enabled === 1,
    announcementText: cleanText(r.announcement_text, 300),
    adsNeedApproval: r.ads_need_approval === 1,
  };
}
