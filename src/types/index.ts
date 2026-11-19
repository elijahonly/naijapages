export type GeopoliticalZoneCode = 'NW' | 'NE' | 'NC' | 'SW' | 'SE' | 'SS';

export interface GeopoliticalZone {
  code: GeopoliticalZoneCode;
  name: string;
  color: string;
  bgLight: string;
}

export interface StateInfo {
  name: string;
  capital: string;
  zone: GeopoliticalZoneCode;
  key: string;
  lgas: string[];
}

export interface BusinessReview {
  id: string;
  businessId: string;
  author: string;
  authorId?: string;
  rating: number;
  date: string;
  createdAt?: number;
  comment: string;
}

/** Moderation state of a community-submitted business listing. */
export type ListingStatus = 'pending' | 'approved' | 'rejected' | 'removed';

/** Moderation state of a marketplace ad. */
export type AdStatus = 'pending' | 'active' | 'removed';

export interface Business {
  id: string;
  name: string;
  category: string;
  state: string;
  lga: string;
  address: string;
  phone: string;
  website?: string;
  whatsapp?: string;
  rating: number;
  reviewsCount: number;
  isVerified: boolean;
  isUserAdded?: boolean;
  description?: string;
  openingHours?: string;
  tags?: string[];
  email?: string;
  priceLevel?: '₦' | '₦₦' | '₦₦₦' | '₦₦₦₦';
  featured?: boolean;
  googleMapUrl?: string; // Compulsory in the add form
  cacNumber?: string; // Corporate Affairs Commission RC or BN number
  cacStatus?: 'registered' | 'pending' | 'unregistered';
  landmark?: string; // Prominent landmark / nearest bus stop
  secondaryPhone?: string;
  yearEstablished?: number;
  paymentMethods?: string[];
  socials?: {
    instagram?: string;
    twitter?: string;
    facebook?: string;
    linkedin?: string;
    tiktok?: string;
  };
  /** True for procedurally generated placeholder listings bundled with the app. */
  isSample?: boolean;
  /** Community listings only (stored in Firestore). */
  ownerId?: string;
  ownerName?: string;
  status?: ListingStatus;
  /** Reason shown to the owner when an admin rejects or removes the listing. */
  moderationNote?: string;
  /** Business branding & photography backed by Cloudflare R2 or verified https URLs. */
  logoUrl?: string;
  coverImageUrl?: string;
  gallery?: string[];
  createdAt?: number; // epoch ms
  /** Set once an admin approves an ownership claim. */
  claimed?: boolean;
}

export interface EmergencyContact {
  service: string;
  number: string;
  agency: string;
  coverage: string;
  description: string;
}

export type MarketplaceCategory =
  | 'Vehicles'
  | 'Phones & Tablets'
  | 'Electronics & Appliances'
  | 'Fashion & Beauty'
  | 'Home, Furniture & Living'
  | 'Real Estate'
  | 'Agriculture & Food'
  | 'Commercial & Industrial'
  | 'Services';

export type MarketplaceCondition =
  | 'Brand New'
  | 'Foreign Used (Tokunbo)'
  | 'Nigerian Used'
  | 'Refurbished';

export interface MarketplaceItem {
  id: string;
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
  locationHub?: string; // e.g. "Computer Village, Ikeja" or "Banex Plaza, Wuse 2"
  phone: string;
  whatsapp?: string;
  isVerifiedSeller: boolean;
  cacNumber?: string;
  featured?: boolean;
  viewsCount: number;
  postedDate: string;
  attributes?: Record<string, string>; // e.g. { "Transmission": "Automatic", "Storage": "256GB" }
  /** Community ads only (stored in Firestore). */
  ownerId?: string;
  ownerName?: string;
  status?: AdStatus;
  moderationNote?: string;
  createdAt?: number; // epoch ms
}

// ---------------------------------------------------------------------------
// Moderation, reports, claims, settings
// ---------------------------------------------------------------------------

export type ReportTargetType = 'business' | 'ad' | 'review';

export const REPORT_REASONS = [
  'Scam or fraud',
  'Fake or misleading listing',
  'Wrong or outdated information',
  'Prohibited item or service',
  'Offensive or inappropriate content',
  'Spam or duplicate',
  'Other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReportStatus = 'open' | 'resolved' | 'dismissed';

export interface ReportRecord {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  targetTitle: string;
  reason: ReportReason;
  details?: string;
  reporterId: string;
  reporterName?: string;
  status: ReportStatus;
  createdAt?: number;
  resolution?: string;
  resolvedBy?: string;
  resolvedAt?: number;
}

export type ClaimStatus = 'pending' | 'approved' | 'rejected';

export interface ClaimRecord {
  id: string;
  businessId: string;
  businessName: string;
  claimantId: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  proofNote?: string;
  proofAttachmentUrl?: string;
  status: ClaimStatus;
  createdAt?: number;
  reviewedBy?: string;
  reviewedAt?: number;
  reviewNote?: string;
}

export interface SiteSettings {
  contactEmail: string;
  contactPhone: string;
  whatsapp: string;
  address: string;
  officeHours: string;
  aboutStory: string;
  announcementEnabled: boolean;
  announcementText: string;
  /** When true, new marketplace ads wait for admin approval before going live. */
  adsNeedApproval: boolean;
}

/** Admin moderation flags for the bundled (seed) directory/marketplace data. */
export interface ListingOverride {
  id: string;
  kind: 'business' | 'marketplace';
  hidden: boolean;
  verified?: boolean;
  claimedBy?: string;
}
