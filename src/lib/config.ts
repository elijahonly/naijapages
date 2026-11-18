/**
 * Central place for site-wide switches. Anything here that touches security
 * must stay in sync with `firestore.rules` (noted next to each flag).
 */

export const SITE_NAME = 'NaijaPages';

/** The site rotates "daily" picks at midnight in this timezone (Nigeria = WAT, UTC+1, no DST). */
export const SITE_TZ = 'Africa/Lagos';

/**
 * Members must have a verified email before they can list a business, post an
 * ad, review, or report. Google sign-in accounts are always verified.
 * ⚠ Keep in sync with `isActiveMember()` in firestore.rules.
 */
export const REQUIRE_VERIFIED_EMAIL = true;

// --- Daily Featured -------------------------------------------------------

/** How many businesses appear in the daily Featured carousel. */
export const FEATURED_BUSINESS_COUNT = 12;

/** How many marketplace ads are pinned as "TOP" each day. */
export const FEATURED_AD_COUNT = 8;

/**
 * The bundled directory contains ~36,500 procedurally generated placeholder
 * listings (flagged `isSample`). They stay searchable, but are kept out of the
 * Featured spotlight unless you flip this to `true`.
 */
export const FEATURED_INCLUDE_SAMPLE_LISTINGS = false;

// --- Data loading ---------------------------------------------------------

/** Max community businesses / ads fetched for the public site. */
export const MAX_PUBLIC_DOCS = 500;

/** Max rows an admin list loads at once. */
export const MAX_ADMIN_DOCS = 400;

// --- Firestore collection names ------------------------------------------

export const COL = {
  users: 'users',
  admins: 'admins',
  bans: 'bans',
  businesses: 'businesses',
  marketplace: 'marketplace',
  reviews: 'reviews',
  reports: 'reports',
  claims: 'claims',
  contactMessages: 'contact_messages',
  subscribers: 'newsletter_subscribers',
  settings: 'settings',
  overrides: 'listing_overrides',
  audit: 'audit_log',
} as const;

export const SITE_SETTINGS_DOC = 'site';

export const DEFAULT_SETTINGS = {
  contactEmail: '',
  contactPhone: '',
  whatsapp: '',
  address: '',
  officeHours: '',
  aboutStory: '',
  announcementEnabled: false,
  announcementText: '',
  adsNeedApproval: false,
} as const;

/** Field limits — mirrored in firestore.rules so the server enforces the same caps. */
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
  review: 1000,
  reportDetails: 1000,
  contactSubject: 150,
  contactMessage: 3000,
  displayName: 100,
} as const;
