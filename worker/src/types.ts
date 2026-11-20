import type { DiscoveryJobType } from './lib/discoveryValidation';

export const DISCOVERY_QUEUE_MESSAGE_SCHEMA_VERSION = 1 as const;

/**
 * Compact Cloudflare Queue payload identifying a persistent D1 discovery job.
 * D1 (`discovery_jobs`) is always the source of truth — never store business records
 * or large payloads inside queue messages.
 */
export interface DiscoveryQueueMessage {
  schemaVersion: typeof DISCOVERY_QUEUE_MESSAGE_SCHEMA_VERSION;
  jobId: string;
  jobType: DiscoveryJobType;
  enqueuedAt: number;
  correlationId: string;
}

export type DiscoveryQueueBinding = Queue<DiscoveryQueueMessage>;
export type DiscoveryQueueBatch = MessageBatch<DiscoveryQueueMessage>;
export type DiscoveryQueueMessageItem = Message<DiscoveryQueueMessage>;
export type DiscoveryScheduledController = ScheduledController;

export interface Bindings {
  // Core Cloudflare infrastructure bindings
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  RATE_LIMIT_KV?: KVNamespace;
  DISCOVERY_QUEUE?: DiscoveryQueueBinding;
  ASSETS?: Fetcher;

  // Non-secret environment variables (configured in wrangler.toml [vars])
  APP_ENV: string;
  APP_NAME: string;
  APP_URL: string;
  CORS_ORIGINS?: string;
  REQUIRE_VERIFIED_EMAIL?: string;
  R2_PUBLIC_BASE_URL?: string;

  // Business discovery feature controls (safe disabled defaults in wrangler.toml)
  DISCOVERY_ENABLED?: string;
  DISCOVERY_SCHEDULER_ENABLED?: string;
  DISCOVERY_DRY_RUN?: string;
  DISCOVERY_MAX_JOBS_PER_RUN?: string;
  DISCOVERY_MAX_ATTEMPTS?: string;
  DISCOVERY_STALE_JOB_TIMEOUT_MS?: string;
  DISCOVERY_MAX_QUEUED_BACKLOG?: string;

  // OpenStreetMap Overpass connector configuration (non-secret; empty URL by default)
  OSM_OVERPASS_URL?: string;
  OSM_USER_AGENT?: string;
  OSM_REQUEST_TIMEOUT_MS?: string;
  OSM_MAX_RESPONSE_BYTES?: string;

  // Worker secrets (set via .dev.vars locally or `wrangler secret put` in Cloudflare)
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  BOOTSTRAP_ADMIN_EMAIL?: string;
}

export interface AuthSessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  role: 'user' | 'admin';
  banned: boolean;
  banReason?: string;
}

export interface Variables {
  requestId: string;
  authUser?: AuthSessionUser | null;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: Variables;
}
