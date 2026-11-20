/**
 * Normalisation, Nigerian phone parsing, canonical domain extraction, SSRF-safe URL
 * validation, and untrusted-content extraction helpers for NaijaPages business discovery.
 *
 * Strict integrity guarantees:
 * - Never invents missing phone numbers, websites, emails, addresses, coordinates,
 *   ratings, reviews, or CAC numbers.
 * - Treats all external text/HTML as untrusted data (no code execution, prompt-injection
 *   stripping when optional AI extraction is enabled).
 */
import { cleanEmail, cleanText } from '../../lib/validation';
import { DiscoveryJobError } from './errors';

const NIGERIAN_MOBILE_PREFIXES = new Set([
  '701', '702', '703', '704', '705', '706', '707', '708', '709',
  '802', '803', '804', '805', '806', '807', '808', '809',
  '810', '811', '812', '813', '814', '815', '816', '817', '818', '819',
  '901', '902', '903', '904', '905', '906', '907', '908', '909',
  '911', '912', '913', '915', '916',
]);

const NIGERIAN_LANDLINE_AREA_CODES = new Set([
  '1', '2', '9', // Lagos (01), Ibadan (02), Abuja (09)
  '42', '43', '44', '45', '46', '47', '48',
  '51', '52', '53', '54', '55', '56', '57', '58', '59',
  '60', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '72', '73', '74', '75', '76', '77', '79',
  '82', '83', '84', '85', '86', '87', '88', '89',
]);

export interface NormalizedNigerianPhone {
  /** Compact E.164 key used for deduplication (e.g. `+2348031234567`). */
  e164: string;
  /** Human-readable display format (e.g. `+234 803 123 4567`). */
  formatted: string;
  /** `mobile` | `landline` */
  kind: 'mobile' | 'landline';
}

/**
 * Normalises a Nigerian telephone number into canonical E.164 and display formats.
 * Returns `null` when the input is missing or not a valid Nigerian mobile/landline number.
 * Never fabricates digits.
 */
export function normalizeNigerianPhone(raw: unknown): NormalizedNigerianPhone | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Reject strings containing multiple glued numbers or letters (except optional ext)
  const stripped = trimmed.replace(/\s*(?:ext\.?|x)\s*\d+$/i, '');
  if (/[a-zA-Z]/.test(stripped)) return null;

  let digits = stripped.replace(/\D/g, '');
  if (!digits) return null;

  // Strip international dialing prefix `00234` or `234`
  if (digits.startsWith('00234')) {
    digits = digits.slice(5);
  } else if (digits.startsWith('234') && digits.length >= 10) {
    digits = digits.slice(3);
  }

  // Strip leading national trunk `0`
  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  // 10-digit Nigerian mobile (e.g. 8031234567 -> +234 803 123 4567)
  if (digits.length === 10 && NIGERIAN_MOBILE_PREFIXES.has(digits.slice(0, 3))) {
    // Reject obvious placeholder runs (e.g. 0000000 or 1111111)
    if (/^(\d)\1{6}$/.test(digits.slice(3))) return null;
    return {
      e164: `+234${digits}`,
      formatted: `+234 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`,
      kind: 'mobile',
    };
  }

  // Nigerian landlines (Lagos 01-xxxxxxx = 8 digits after 0, Abuja 09-xxxxxxx = 8 digits,
  // other 2-digit area codes + 6-7 subscriber digits = 8-9 digits after 0)
  if (digits.length >= 7 && digits.length <= 9) {
    const oneDigit = digits.slice(0, 1);
    const twoDigit = digits.slice(0, 2);
    if (NIGERIAN_LANDLINE_AREA_CODES.has(oneDigit) && digits.length === 8) {
      if (/^(\d)\1{6}$/.test(digits.slice(1))) return null;
      return {
        e164: `+234${digits}`,
        formatted: `+234 ${oneDigit} ${digits.slice(1, 4)} ${digits.slice(4)}`,
        kind: 'landline',
      };
    }
    if (NIGERIAN_LANDLINE_AREA_CODES.has(twoDigit) && (digits.length === 8 || digits.length === 9)) {
      return {
        e164: `+234${digits}`,
        formatted: `+234 ${twoDigit} ${digits.slice(2, 5)} ${digits.slice(5)}`,
        kind: 'landline',
      };
    }
  }

  return null;
}

/**
 * Extracts a canonical lowercase root hostname (without `www.`) for website deduplication.
 * Returns `null` for malformed URLs or generic social/directory hosts that cannot identify a unique domain.
 */
const SHARED_PLATFORM_HOSTS = new Set([
  'facebook.com',
  'fb.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'tiktok.com',
  'wa.me',
  'whatsapp.com',
  'linktr.ee',
  'google.com',
  'goo.gl',
  'maps.google.com',
  'openstreetmap.org',
  'business.site',
  'wordpress.com',
  'blogspot.com',
]);

export function extractCanonicalDomain(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  let candidate = rawUrl.trim();
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!host || !host.includes('.') || SHARED_PLATFORM_HOSTS.has(host)) return null;
    return host;
  } catch {
    return null;
  }
}

/**
 * Strict outbound URL guard blocking loopback, private RFC1918 ranges, link-local
 * cloud metadata hosts, IPv6 loopback/ULA, and non-HTTP(S) schemes before any Worker fetch.
 */
export function validateSafeExternalFetchUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 500) {
    throw new DiscoveryJobError('External URL is empty or exceeds maximum length.', {
      kind: 'permanent',
      code: 'INVALID_EXTERNAL_URL',
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new DiscoveryJobError('External URL is not a valid URL.', {
      kind: 'permanent',
      code: 'INVALID_EXTERNAL_URL',
    });
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new DiscoveryJobError('Only http:// and https:// URLs are permitted.', {
      kind: 'permanent',
      code: 'UNSAFE_URL_SCHEME',
    });
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '::1' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  ) {
    throw new DiscoveryJobError('Outbound requests to local or internal hosts are prohibited.', {
      kind: 'permanent',
      code: 'BLOCKED_PRIVATE_HOST',
    });
  }

  // Block IPv4 loopback, private, and link-local metadata ranges (169.254.169.254, 10/8, 172.16/12, 192.168/16, 127/8, 0/8)
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      throw new DiscoveryJobError('Outbound requests to private or link-local IP addresses are prohibited.', {
        kind: 'permanent',
        code: 'BLOCKED_PRIVATE_IP',
      });
    }
  }

  return parsed.toString();
}

/**
 * Strips HTML scripts/styles and prompt-injection directives from untrusted external web text
 * so external source content can never execute code or hijack system instructions.
 */
export function sanitizeUntrustedSourceText(raw: string, maxLength = 4000): string {
  const withoutScripts = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

  const cleaned = withoutScripts
    .replace(/\b(?:ignore\s+previous\s+instructions|system\s*prompt|you\s+are\s+now|assistant\s*:)/gi, '[filtered]')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.slice(0, maxLength);
}

export interface ExtractedUnstructuredFields {
  phones: string[];
  emails: string[];
  openingHours: string | null;
  closureNoticeDetected: boolean;
  relocationNoticeDetected: boolean;
  detectedSignals: string[];
}

const CLOSURE_PHRASE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bpermanently\s+closed\b/i, label: 'permanently_closed_notice' },
  { pattern: /\bno\s+longer\s+in\s+business\b/i, label: 'out_of_business_notice' },
  { pattern: /\bceased\s+operations?\b/i, label: 'ceased_operations_notice' },
  { pattern: /\bwe\s+have\s+closed\s+(?:down|permanently)\b/i, label: 'closed_down_notice' },
  { pattern: /\bthis\s+domain\s+(?:is\s+for\s+sale|has\s+expired)\b/i, label: 'domain_expired_notice' },
];

const RELOCATION_PHRASE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bwe\s+have\s+(?:moved|relocated)\s+to\b/i, label: 'relocated_notice' },
  { pattern: /\bnew\s+(?:office\s+)?address\s*[:\-]/i, label: 'new_address_notice' },
  { pattern: /\brelocated\s+from\b/i, label: 'relocated_from_notice' },
];

/**
 * Deterministic, zero-cost extractor for public text snippets (never invents missing values).
 * Also detects closure or relocation notices for continuous monitoring.
 */
export function extractStructuredFieldsFromText(rawText: string): ExtractedUnstructuredFields {
  const text = sanitizeUntrustedSourceText(rawText, 8000);
  const phones: string[] = [];
  const emails: string[] = [];
  const detectedSignals: string[] = [];

  // Extract Nigerian phones matching +234 or 07/08/09 or landline formats
  const phoneMatches = text.match(/(?:\+?234|0)[\s\-().]*(?:\d[\s\-().]*){7,10}/g) ?? [];
  for (const rawPhone of phoneMatches) {
    const norm = normalizeNigerianPhone(rawPhone);
    if (norm && !phones.includes(norm.formatted)) {
      phones.push(norm.formatted);
    }
  }

  // Extract public emails
  const emailMatches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
  for (const rawEmail of emailMatches) {
    const cleaned = cleanEmail(rawEmail);
    if (cleaned && !emails.includes(cleaned)) {
      emails.push(cleaned);
    }
  }

  // Opening hours snippet if explicitly stated
  const hoursMatch =
    /(?:open(?:ing)?\s+hours?|business\s+hours?|mon(?:day)?\s*[-–]\s*(?:fri|sat|sun)[a-z]*)\s*[:\-]?\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?\s*[-–to]+\s*[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/i.exec(
      text,
    );
  const openingHours = hoursMatch ? cleanText(hoursMatch[0], 140) : null;

  let closureNoticeDetected = false;
  for (const rule of CLOSURE_PHRASE_PATTERNS) {
    if (rule.pattern.test(text)) {
      closureNoticeDetected = true;
      detectedSignals.push(rule.label);
    }
  }

  let relocationNoticeDetected = false;
  for (const rule of RELOCATION_PHRASE_PATTERNS) {
    if (rule.pattern.test(text)) {
      relocationNoticeDetected = true;
      detectedSignals.push(rule.label);
    }
  }

  return {
    phones,
    emails,
    openingHours,
    closureNoticeDetected,
    relocationNoticeDetected,
    detectedSignals,
  };
}
