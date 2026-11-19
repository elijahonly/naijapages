/**
 * Input hygiene shared by every form that writes user content.
 *
 * These checks are the *first* line of defence (and give friendly error
 * messages). The authoritative checks live in the Cloudflare Worker API (`worker/src/lib/validation.ts`).
 */

// Control characters, zero-width characters and bidi-override characters
// (the latter are used to visually spoof text). Tab/newline/CR are kept.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Single-line text: strips invisible characters and collapses whitespace. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(INVISIBLE, '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

/** Multi-line text (descriptions, messages): keeps paragraphs, strips invisible characters. */
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

const DANGEROUS_SCHEMES = /^(javascript|data|vbscript|file|blob|about|ftp):/i;

/**
 * Returns a normalised http(s) URL, or `undefined` if the value is not a safe
 * web address. Rejects `javascript:`/`data:` URLs and URLs with embedded
 * credentials. Bare domains ("example.com") are upgraded to https.
 */
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
    if (!u.hostname.includes('.')) return undefined; // "https://localhost", "https://abc"
    return u.toString();
  } catch {
    return undefined;
  }
}

const SAFE_MEDIA_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,220}(\.[a-zA-Z0-9]{1,10})?$/;

/**
 * Accepts either a Worker/R2 `/api/media/<key>` delivery path or a safe `https://` URL.
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
    if (!rest || rest.includes('..') || rest.includes('//') || rest.includes('\\')) return undefined;
    if (rest.includes('?') || rest.includes('#')) return undefined;
    if (!SAFE_MEDIA_KEY_RE.test(rest)) return undefined;
    if (!opts.allowPrivate && rest.startsWith('private/')) return undefined;
    return `/api/media/${rest}`;
  }

  return safeHttpUrl(raw, { httpsOnly: true, max: opts.max ?? 600 });
}

/**
 * Strict allow-list for Google Maps links. A loose `includes('google.')` check
 * would accept `https://google.evil.com/…`, so we match the exact hosts.
 */
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

/** Allowed hosts for social profile links. */
const SOCIAL_HOSTS: Record<string, RegExp> = {
  instagram: /(^|\.)instagram\.com$/,
  twitter: /(^|\.)(x|twitter)\.com$/,
  facebook: /(^|\.)(facebook|fb)\.com$/,
  linkedin: /(^|\.)linkedin\.com$/,
  tiktok: /(^|\.)tiktok\.com$/,
};

export function safeSocialUrl(platform: keyof typeof SOCIAL_HOSTS, value: unknown): string | undefined {
  const url = safeHttpUrl(value, { httpsOnly: true, max: 200 });
  if (!url) return undefined;
  return SOCIAL_HOSTS[platform].test(new URL(url).hostname.toLowerCase()) ? url : undefined;
}

/** Nigerian-friendly phone check: digits, +, spaces, dashes, brackets; 7–15 digits. */
export function cleanPhone(value: unknown): string | undefined {
  const raw = cleanText(value, 25);
  if (!/^[0-9+()\-\s]{7,25}$/.test(raw)) return undefined;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? raw : undefined;
}

export const EMAIL_RE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

export function cleanEmail(value: unknown): string | undefined {
  const v = cleanText(value, 150).toLowerCase();
  return EMAIL_RE.test(v) ? v : undefined;
}

/** Recursively removes `undefined` and empty strings/arrays/objects from JSON payloads. */
export function compact<T>(input: T): T {
  if (Array.isArray(input)) {
    const arr = input.map((v) => compact(v)).filter((v) => v !== undefined);
    return (arr.length ? arr : undefined) as unknown as T;
  }
  if (input && typeof input === 'object' && Object.getPrototypeOf(input) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const c = compact(v);
      if (c !== undefined && c !== '') out[k] = c;
    }
    return (Object.keys(out).length ? out : undefined) as unknown as T;
  }
  return input === '' ? (undefined as unknown as T) : input;
}

/** Password policy enforced for new accounts (aligned with Better Auth configuration). */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Include at least one letter and one number.';
  return null;
}

/** Light client-side throttle to stop accidental/double submissions (not a security control on its own). */
export function cooldownRemaining(key: string, ms: number): number {
  try {
    const last = Number(sessionStorage.getItem(`np_cd_${key}`) || 0);
    return Math.max(0, last + ms - Date.now());
  } catch {
    return 0;
  }
}

export function startCooldown(key: string): void {
  try {
    sessionStorage.setItem(`np_cd_${key}`, String(Date.now()));
  } catch {
    /* storage unavailable (private mode) – ignore */
  }
}

/** CSV cell escaping, including protection against spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
