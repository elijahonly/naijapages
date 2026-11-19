export interface Bindings {
  // Core Cloudflare infrastructure bindings
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  RATE_LIMIT_KV?: KVNamespace;
  ASSETS?: Fetcher;

  // Non-secret environment variables (configured in wrangler.toml [vars])
  APP_ENV: string;
  APP_NAME: string;
  APP_URL: string;
  CORS_ORIGINS?: string;
  REQUIRE_VERIFIED_EMAIL?: string;
  R2_PUBLIC_BASE_URL?: string;

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
