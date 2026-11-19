import type { Business } from '../types';
import { cleanText, safeHttpUrl } from './security';

export type QrTargetType = 'whatsapp' | 'website';

export interface QrTargetOption {
  type: QrTargetType;
  label: string;
  available: boolean;
  url: string | null;
  displayValue: string | null;
  unavailableReason?: string;
}

export interface BusinessQrResolution {
  targets: Record<QrTargetType, QrTargetOption>;
  availableTypes: QrTargetType[];
  defaultTarget: QrTargetType | null;
  hasAnyTarget: boolean;
  defaultGreeting: string;
}

/**
 * Normalizes a Nigerian or international phone/WhatsApp number to E.164 digits
 * suitable for `https://wa.me/<digits>`. Returns `null` if invalid.
 */
export function normalizeWhatsAppDigits(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (!hasPlus) {
    if (digits.startsWith('0') && digits.length >= 8 && digits.length <= 11) {
      digits = `234${digits.slice(1)}`;
    } else if (!digits.startsWith('234') && digits.length === 10) {
      digits = `234${digits}`;
    }
  }

  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

/**
 * Builds a direct `https://wa.me/...` URL that opens WhatsApp immediately when scanned.
 * Optionally attaches a pre-filled greeting message.
 */
export function buildDirectWhatsAppQrUrl(
  rawNumber: string | undefined | null,
  greeting?: string,
): string | null {
  const digits = normalizeWhatsAppDigits(rawNumber);
  if (!digits) return null;

  const cleanedGreeting = cleanText(greeting ?? '', 240);
  if (!cleanedGreeting) {
    return `https://wa.me/${digits}`;
  }
  return `https://wa.me/${digits}?text=${encodeURIComponent(cleanedGreeting)}`;
}

/**
 * Normalizes a business website into a safe `http(s)://` URL suitable for QR encoding.
 */
export function buildDirectWebsiteQrUrl(rawWebsite: string | undefined | null): string | null {
  return safeHttpUrl(rawWebsite, { httpsOnly: false, max: 500 }) ?? null;
}

/**
 * Resolves the available direct QR destinations (WhatsApp and Website) for any business.
 */
export function resolveBusinessQrTargets(
  business: Pick<Business, 'name' | 'whatsapp' | 'phone' | 'website'>,
  options: { greeting?: string; includeGreeting?: boolean } = {},
): BusinessQrResolution {
  const defaultGreeting = `Hello ${cleanText(business.name, 80) || 'there'}, I scanned your QR code on NaijaPages.`;
  const effectiveGreeting =
    options.includeGreeting === false
      ? ''
      : options.greeting !== undefined
        ? options.greeting
        : defaultGreeting;

  const rawWhatsApp = business.whatsapp?.trim() || business.phone?.trim() || '';
  const whatsappDigits = normalizeWhatsAppDigits(rawWhatsApp);
  const whatsappUrl = whatsappDigits ? buildDirectWhatsAppQrUrl(rawWhatsApp, effectiveGreeting) : null;

  const websiteUrl = buildDirectWebsiteQrUrl(business.website);

  const whatsappOption: QrTargetOption = {
    type: 'whatsapp',
    label: 'WhatsApp',
    available: Boolean(whatsappUrl),
    url: whatsappUrl,
    displayValue: whatsappDigits ? `+${whatsappDigits}` : null,
    unavailableReason: whatsappUrl ? undefined : 'No WhatsApp or phone number listed',
  };

  const websiteOption: QrTargetOption = {
    type: 'website',
    label: 'Website',
    available: Boolean(websiteUrl),
    url: websiteUrl,
    displayValue: websiteUrl ? formatCompactUrl(websiteUrl) : null,
    unavailableReason: websiteUrl ? undefined : 'No website URL listed',
  };

  const availableTypes: QrTargetType[] = [];
  if (whatsappOption.available) availableTypes.push('whatsapp');
  if (websiteOption.available) availableTypes.push('website');

  return {
    targets: {
      whatsapp: whatsappOption,
      website: websiteOption,
    },
    availableTypes,
    defaultTarget: availableTypes[0] ?? null,
    hasAnyTarget: availableTypes.length > 0,
    defaultGreeting,
  };
}

/**
 * Compact display format for showing the destination URL under the QR code.
 */
export function formatCompactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    const full = `${host}${path}`;
    return full.length > 52 ? `${full.slice(0, 49)}…` : full;
  } catch {
    return url.slice(0, 52);
  }
}

/**
 * Produces a filesystem-safe download filename for exported PNG/SVG QR files.
 */
export function buildQrFileName(
  businessName: string,
  target: QrTargetType,
  ext: 'png' | 'svg',
): string {
  const slug = cleanText(businessName, 60)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'business'}-${target}-qr.${ext}`;
}
