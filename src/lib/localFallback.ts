import { Business, BusinessReview, MarketplaceItem } from '../types';

const KEYS = {
  businesses: 'naijapages_local_businesses_v1',
  ads: 'naijapages_local_ads_v1',
  reviews: 'naijapages_local_reviews_v1',
  contact: 'naijapages_local_contact_v1',
  newsletter: 'naijapages_local_newsletter_v1',
} as const;

export const LOCAL_DATA_EVENT = 'naijapages:local-data-changed';

export function isPermissionDenied(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'permission-denied';
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function readStoredList<T>(key: string): T[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function writeStoredList<T>(key: string, items: T[]): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(LOCAL_DATA_EVENT));
  } catch {
    // Ignore quota / private mode storage errors.
  }
}

export function getLocalBusinesses(): Business[] {
  return readStoredList<Business>(KEYS.businesses);
}

export function getLocalAds(): MarketplaceItem[] {
  return readStoredList<MarketplaceItem>(KEYS.ads);
}

export function getLocalReviews(businessId: string): BusinessReview[] {
  return readStoredList<BusinessReview>(KEYS.reviews)
    .filter((r) => r.businessId === businessId)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function deleteLocalReview(reviewId: string): boolean {
  const all = readStoredList<BusinessReview>(KEYS.reviews);
  const next = all.filter((r) => r.id !== reviewId);
  if (next.length === all.length) return false;
  writeStoredList(KEYS.reviews, next);
  return true;
}

export interface LocalContactMessage {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  uid?: string;
  createdAt: number;
}

export function saveLocalContactMessage(entry: Omit<LocalContactMessage, 'id' | 'createdAt'>): void {
  const all = readStoredList<LocalContactMessage>(KEYS.contact);
  const next: LocalContactMessage = {
    ...entry,
    id: `local_msg_${Date.now()}`,
    createdAt: Date.now(),
  };
  writeStoredList(KEYS.contact, [next, ...all].slice(0, 50));
}

export interface LocalSubscriber {
  email: string;
  source: string;
  subscribedAt: string;
}

export function saveLocalSubscriber(email: string, source: string): void {
  const normalized = email.trim().toLowerCase();
  const all = readStoredList<LocalSubscriber>(KEYS.newsletter);
  if (all.some((s) => s.email === normalized)) return;
  writeStoredList(KEYS.newsletter, [
    { email: normalized, source, subscribedAt: new Date().toISOString() },
    ...all,
  ]);
}
