import { drizzle } from 'drizzle-orm/d1';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  role: text('role').notNull().default('user'),
  banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
  banReason: text('ban_reason'),
  bannedBy: text('banned_by'),
  bannedAt: integer('banned_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  key: text('key').notNull(),
  label: text('label').notNull(),
  emoji: text('emoji').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull().default(0),
});

export const businesses = sqliteTable('businesses', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  ownerName: text('owner_name').notNull().default(''),
  name: text('name').notNull(),
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  category: text('category').notNull(),
  state: text('state').notNull(),
  lga: text('lga').notNull(),
  address: text('address').notNull(),
  landmark: text('landmark'),
  phone: text('phone').notNull(),
  secondaryPhone: text('secondary_phone'),
  whatsapp: text('whatsapp'),
  email: text('email'),
  website: text('website'),
  googleMapUrl: text('google_map_url').notNull(),
  logoUrl: text('logo_url'),
  coverImageUrl: text('cover_image_url'),
  galleryJson: text('gallery_json').notNull().default('[]'),
  cacStatus: text('cac_status'),
  cacNumber: text('cac_number'),
  yearEstablished: integer('year_established'),
  priceLevel: text('price_level'),
  paymentMethodsJson: text('payment_methods_json').notNull().default('[]'),
  socialsJson: text('socials_json').notNull().default('{}'),
  tagsJson: text('tags_json').notNull().default('[]'),
  openingHours: text('opening_hours'),
  description: text('description'),
  rating: real('rating').notNull().default(0),
  reviewsCount: integer('reviews_count').notNull().default(0),
  status: text('status').notNull().default('pending'),
  isVerified: integer('is_verified', { mode: 'boolean' }).notNull().default(false),
  claimed: integer('claimed', { mode: 'boolean' }).notNull().default(false),
  claimedFromSeedId: text('claimed_from_seed_id'),
  moderationNote: text('moderation_note'),
  reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
  reviewedAt: integer('reviewed_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const marketplaceItems = sqliteTable('marketplace_items', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  ownerName: text('owner_name').notNull().default(''),
  businessId: text('business_id').references(() => businesses.id, { onDelete: 'set null' }),
  businessName: text('business_name').notNull(),
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  category: text('category').notNull(),
  price: integer('price').notNull(),
  isNegotiable: integer('is_negotiable', { mode: 'boolean' }).notNull().default(false),
  condition: text('condition').notNull(),
  description: text('description').notNull(),
  imageUrl: text('image_url').notNull(),
  additionalImagesJson: text('additional_images_json').notNull().default('[]'),
  state: text('state').notNull(),
  lga: text('lga').notNull(),
  locationHub: text('location_hub'),
  phone: text('phone').notNull(),
  whatsapp: text('whatsapp'),
  cacNumber: text('cac_number'),
  featured: integer('featured', { mode: 'boolean' }).notNull().default(false),
  viewsCount: integer('views_count').notNull().default(0),
  status: text('status').notNull().default('active'),
  moderationNote: text('moderation_note'),
  reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
  reviewedAt: integer('reviewed_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  businessId: text('business_id').notNull(),
  authorId: text('author_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  authorName: text('author_name').notNull(),
  rating: integer('rating').notNull(),
  comment: text('comment').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const favourites = sqliteTable('favourites', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  businessId: text('business_id').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const claims = sqliteTable('claims', {
  id: text('id').primaryKey(),
  businessId: text('business_id').notNull(),
  businessName: text('business_name').notNull(),
  claimantId: text('claimant_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  role: text('role').notNull(),
  proofNote: text('proof_note'),
  proofAttachmentUrl: text('proof_attachment_url'),
  status: text('status').notNull().default('pending'),
  reviewNote: text('review_note'),
  reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
  reviewedAt: integer('reviewed_at'),
  createdAt: integer('created_at').notNull(),
});

export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  targetTitle: text('target_title').notNull(),
  reason: text('reason').notNull(),
  details: text('details'),
  reporterId: text('reporter_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  reporterName: text('reporter_name'),
  status: text('status').notNull().default('open'),
  resolution: text('resolution'),
  resolvedBy: text('resolved_by').references(() => user.id, { onDelete: 'set null' }),
  resolvedAt: integer('resolved_at'),
  createdAt: integer('created_at').notNull(),
});

export const listingOverrides = sqliteTable('listing_overrides', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  listingId: text('listing_id').notNull(),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
  claimedBy: text('claimed_by').references(() => user.id, { onDelete: 'set null' }),
  updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
  updatedAt: integer('updated_at').notNull(),
});

export const adminRecords = sqliteTable('admin_records', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  email: text('email').notNull().default(''),
  addedBy: text('added_by').references(() => user.id, { onDelete: 'set null' }),
  addedAt: integer('added_at').notNull(),
});

export const userBans = sqliteTable('user_bans', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  email: text('email').notNull().default(''),
  name: text('name').notNull().default(''),
  reason: text('reason').notNull().default(''),
  bannedBy: text('banned_by').references(() => user.id, { onDelete: 'set null' }),
  bannedAt: integer('banned_at').notNull(),
});

export const contactMessages = sqliteTable('contact_messages', {
  id: text('id').primaryKey(),
  uid: text('uid').references(() => user.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  email: text('email').notNull(),
  subject: text('subject').notNull(),
  message: text('message').notNull(),
  status: text('status').notNull().default('new'),
  createdAt: integer('created_at').notNull(),
});

export const newsletterSubscribers = sqliteTable('newsletter_subscribers', {
  email: text('email').primaryKey(),
  source: text('source').notNull().default('homepage_banner'),
  status: text('status').notNull().default('active'),
  subscribedAt: text('subscribed_at').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const siteSettings = sqliteTable('site_settings', {
  id: text('id').primaryKey(),
  contactEmail: text('contact_email').notNull().default(''),
  contactPhone: text('contact_phone').notNull().default(''),
  whatsapp: text('whatsapp').notNull().default(''),
  address: text('address').notNull().default(''),
  officeHours: text('office_hours').notNull().default(''),
  aboutStory: text('about_story').notNull().default(''),
  announcementEnabled: integer('announcement_enabled', { mode: 'boolean' }).notNull().default(false),
  announcementText: text('announcement_text').notNull().default(''),
  adsNeedApproval: integer('ads_need_approval', { mode: 'boolean' }).notNull().default(false),
  updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
  updatedAt: integer('updated_at').notNull(),
});

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  adminId: text('admin_id').notNull(),
  adminEmail: text('admin_email').notNull().default(''),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  summary: text('summary'),
  createdAt: integer('created_at').notNull(),
});

export const mediaObjects = sqliteTable('media_objects', {
  key: text('key').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  purpose: text('purpose').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  visibility: text('visibility').notNull().default('public'),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256'),
  originalFilename: text('original_filename'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const schema = {
  user,
  session,
  account,
  verification,
  categories,
  businesses,
  marketplaceItems,
  reviews,
  favourites,
  claims,
  reports,
  listingOverrides,
  adminRecords,
  userBans,
  contactMessages,
  newsletterSubscribers,
  siteSettings,
  auditLog,
  mediaObjects,
};

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
