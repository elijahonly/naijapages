/**
 * Everything the admin site reads and writes via Cloudflare D1 (`/api/v1/admin/*`).
 *
 * Every mutation executes in an atomic Worker `db.batch(...)` along with its
 * immutable `audit_log` entry, and triggers `emitAdminRefresh()` + `emitDataRefresh()`
 * so admin queues and public views update immediately.
 */
import { DependencyList, useCallback, useEffect, useState } from 'react';
import { LIMITS } from '../lib/config';
import { ADMIN_DATA_EVENT, apiFetch, emitAdminRefresh, emitDataRefresh } from '../lib/apiClient';
import { friendlyError, logError } from '../lib/errors';
import { cleanEmail, cleanMultiline, cleanPhone, cleanText, safeHttpUrl } from '../lib/security';
import { INITIAL_BUSINESSES } from '../data/nigeriaData';
import { INITIAL_MARKETPLACE_ITEMS } from '../data/marketplaceData';
import { Business, ClaimRecord, ListingOverride, MarketplaceItem, ReportRecord, SiteSettings } from '../types';

export interface AdminCtx {
  uid: string;
  email: string;
}

// ---------------------------------------------------------------------------
// Row & Overview types
// ---------------------------------------------------------------------------

export interface UserRow { id: string; email: string; displayName: string; createdAt?: number }
export interface BanRow { id: string; reason?: string; email?: string; name?: string; bannedAt?: number; bannedBy?: string }
export interface AdminRow { id: string; email?: string; addedAt?: number }
export interface MessageRow { id: string; name: string; email: string; subject: string; message: string; status: 'new' | 'read' | 'archived'; createdAt?: number; uid?: string }
export interface SubscriberRow { id: string; email: string; subscribedAt?: number; source?: string }
export interface AuditRow { id: string; adminEmail: string; action: string; targetType?: string; targetId?: string; summary?: string; createdAt?: number }
export interface ReviewRow { id: string; businessId: string; businessName?: string; authorId: string; authorName: string; rating: number; comment: string; createdAt?: number }

export interface AdminOverview {
  stats: { users: number; businesses: number; ads: number; reviews: number; subscribers: number };
  queues: {
    pendingBusinesses: Business[];
    pendingAds: MarketplaceItem[];
    openReports: ReportRecord[];
    pendingClaims: ClaimRecord[];
    newMessageCount: number;
    overrides: ListingOverride[];
  };
  recentAudit: AuditRow[];
}

export interface AdminUsersPayload {
  users: UserRow[];
  bans: BanRow[];
  admins: AdminRow[];
}

// ---------------------------------------------------------------------------
// Reactive D1 query hook (replaces Firestore onSnapshot listeners)
// ---------------------------------------------------------------------------

export function useAdminQuery<T>(
  fetcher: () => Promise<T>,
  initialData: T,
  deps: DependencyList,
): { data: T; loading: boolean; error: string | null; reload: () => void } {
  const [state, setState] = useState<{ data: T; loading: boolean; error: string | null }>({
    data: initialData,
    loading: true,
    error: null,
  });
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const onRefresh = () => setTick((t) => t + 1);
    window.addEventListener(ADMIN_DATA_EVENT, onRefresh);
    return () => window.removeEventListener(ADMIN_DATA_EVENT, onRefresh);
  }, []);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: s.data === initialData }));
    fetcher()
      .then((data) => {
        if (alive) setState({ data, loading: false, error: null });
      })
      .catch((err) => {
        logError('admin query', err);
        if (alive) {
          setState((s) => ({
            ...s,
            loading: false,
            error: friendlyError(err, 'Could not load this data.'),
          }));
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { ...state, reload };
}

// ---------------------------------------------------------------------------
// List / overview fetchers
// ---------------------------------------------------------------------------

export const fetchAdminOverview = () => apiFetch<AdminOverview>('/api/v1/admin/overview');

export const fetchAdminBusinesses = async (limit = 400): Promise<Business[]> =>
  (await apiFetch<{ items: Business[] }>(`/api/v1/admin/businesses?limit=${limit}`)).items;

export const fetchAdminAds = async (limit = 400): Promise<MarketplaceItem[]> =>
  (await apiFetch<{ items: MarketplaceItem[] }>(`/api/v1/admin/marketplace?limit=${limit}`)).items;

export const fetchAdminClaims = async (limit = 400): Promise<ClaimRecord[]> =>
  (await apiFetch<{ items: ClaimRecord[] }>(`/api/v1/admin/claims?limit=${limit}`)).items;

export const fetchAdminReports = async (limit = 400): Promise<ReportRecord[]> =>
  (await apiFetch<{ items: ReportRecord[] }>(`/api/v1/admin/reports?limit=${limit}`)).items;

export const fetchAdminReviews = async (limit = 400): Promise<ReviewRow[]> =>
  (await apiFetch<{ items: ReviewRow[] }>(`/api/v1/admin/reviews?limit=${limit}`)).items;

export const fetchAdminUsers = (limit = 400) =>
  apiFetch<AdminUsersPayload>(`/api/v1/admin/users?limit=${limit}`);

export const fetchAdminMessages = async (limit = 400): Promise<MessageRow[]> =>
  (await apiFetch<{ items: MessageRow[] }>(`/api/v1/admin/messages?limit=${limit}`)).items;

export const fetchAdminSubscribers = async (limit = 400): Promise<SubscriberRow[]> =>
  (await apiFetch<{ items: SubscriberRow[] }>(`/api/v1/admin/subscribers?limit=${limit}`)).items;

export const fetchAdminAuditLog = async (limit = 200): Promise<AuditRow[]> =>
  (await apiFetch<{ items: AuditRow[] }>(`/api/v1/admin/audit?limit=${limit}`)).items;

export const fetchAdminSettings = async (): Promise<SiteSettings> =>
  (await apiFetch<{ settings: SiteSettings }>('/api/v1/admin/settings')).settings;

// ---------------------------------------------------------------------------
// Seed (built-in) data lookups
// ---------------------------------------------------------------------------

let seedBizIndex: Map<string, Business> | null = null;
let seedAdIndex: Map<string, MarketplaceItem> | null = null;

export const seedBusiness = (id: string): Business | undefined => {
  seedBizIndex ??= new Map(INITIAL_BUSINESSES.map((b) => [b.id, b]));
  return seedBizIndex.get(id);
};
export const seedAd = (id: string): MarketplaceItem | undefined => {
  seedAdIndex ??= new Map(INITIAL_MARKETPLACE_ITEMS.map((a) => [a.id, a]));
  return seedAdIndex.get(id);
};

export const overrideDocId = (kind: 'business' | 'marketplace', id: string) => `${kind}_${id}`;

function notifyAll() {
  emitAdminRefresh();
  emitDataRefresh();
}

// ---------------------------------------------------------------------------
// Businesses (community listings)
// ---------------------------------------------------------------------------

export const approveBusiness = async (_admin: AdminCtx, b: Business, verify: boolean) => {
  await apiFetch(`/api/v1/admin/businesses/${encodeURIComponent(b.id)}/approve`, {
    method: 'POST',
    body: { verify },
  });
  notifyAll();
};

export const rejectBusiness = async (_admin: AdminCtx, b: Business, note: string) => {
  await apiFetch(`/api/v1/admin/businesses/${encodeURIComponent(b.id)}/reject`, {
    method: 'POST',
    body: { note: cleanText(note, 500) },
  });
  notifyAll();
};

export const removeBusiness = async (_admin: AdminCtx, b: Business, note: string) => {
  await apiFetch(`/api/v1/admin/businesses/${encodeURIComponent(b.id)}/remove`, {
    method: 'POST',
    body: { note: cleanText(note, 500) },
  });
  notifyAll();
};

export const restoreBusiness = async (_admin: AdminCtx, b: Business) => {
  await apiFetch(`/api/v1/admin/businesses/${encodeURIComponent(b.id)}/restore`, {
    method: 'POST',
    body: {},
  });
  notifyAll();
};

export const setBusinessVerified = async (_admin: AdminCtx, b: Business, verified: boolean) => {
  await apiFetch(`/api/v1/admin/businesses/${encodeURIComponent(b.id)}/verify`, {
    method: 'POST',
    body: { verified },
  });
  notifyAll();
};

export const deleteBusinessForever = async (_admin: AdminCtx, b: Business) => {
  await apiFetch(`/api/v1/admin/businesses/${encodeURIComponent(b.id)}`, {
    method: 'DELETE',
  });
  notifyAll();
};

export interface BusinessEdit {
  name: string;
  category: string;
  state: string;
  lga: string;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  openingHours: string;
  description: string;
}

/** Light-touch corrections by an admin (typos, formatting). */
export const editBusiness = async (_admin: AdminCtx, b: Business, e: BusinessEdit) => {
  const name = cleanText(e.name, LIMITS.name);
  if (name.length < 2) throw new Error('The business name is too short.');
  const phone = cleanPhone(e.phone);
  if (!phone) throw new Error('The phone number is not valid.');
  const whatsapp = e.whatsapp.trim() ? cleanPhone(e.whatsapp) : undefined;
  if (e.whatsapp.trim() && !whatsapp) throw new Error('The WhatsApp number is not valid.');
  const email = e.email.trim() ? cleanEmail(e.email) : undefined;
  if (e.email.trim() && !email) throw new Error('The email address is not valid.');
  const website = e.website.trim()
    ? safeHttpUrl(e.website.trim().replace(/^http:\/\//i, 'https://'), { httpsOnly: true, max: LIMITS.url })
    : undefined;
  if (e.website.trim() && !website) throw new Error('The website address is not valid.');

  await apiFetch(`/api/v1/admin/businesses/${encodeURIComponent(b.id)}`, {
    method: 'PATCH',
    body: {
      name,
      category: cleanText(e.category, LIMITS.category) || b.category,
      state: cleanText(e.state, LIMITS.state) || b.state,
      lga: cleanText(e.lga, LIMITS.lga) || b.lga,
      address: cleanText(e.address, LIMITS.address) || b.address,
      phone,
      whatsapp: whatsapp ?? '',
      email: email ?? '',
      website: website ?? '',
      openingHours: cleanText(e.openingHours, LIMITS.hours),
      description: cleanMultiline(e.description, LIMITS.description),
    },
  });
  notifyAll();
};

// ---------------------------------------------------------------------------
// Marketplace ads
// ---------------------------------------------------------------------------

export const approveAd = async (_admin: AdminCtx, a: MarketplaceItem) => {
  await apiFetch(`/api/v1/admin/marketplace/${encodeURIComponent(a.id)}/approve`, {
    method: 'POST',
    body: {},
  });
  notifyAll();
};

export const removeAd = async (_admin: AdminCtx, a: MarketplaceItem, note: string) => {
  await apiFetch(`/api/v1/admin/marketplace/${encodeURIComponent(a.id)}/remove`, {
    method: 'POST',
    body: { note: cleanText(note, 500) },
  });
  notifyAll();
};

export const restoreAd = async (_admin: AdminCtx, a: MarketplaceItem) => {
  await apiFetch(`/api/v1/admin/marketplace/${encodeURIComponent(a.id)}/restore`, {
    method: 'POST',
    body: {},
  });
  notifyAll();
};

export const deleteAdForever = async (_admin: AdminCtx, a: MarketplaceItem) => {
  await apiFetch(`/api/v1/admin/marketplace/${encodeURIComponent(a.id)}`, {
    method: 'DELETE',
  });
  notifyAll();
};

// ---------------------------------------------------------------------------
// Built-in (seed) listings: hide / restore through listing_overrides
// ---------------------------------------------------------------------------

export async function setSeedHidden(
  _admin: AdminCtx,
  kind: 'business' | 'marketplace',
  id: string,
  title: string,
  hidden: boolean,
  _existing?: ListingOverride,
) {
  await apiFetch('/api/v1/admin/overrides', {
    method: 'PUT',
    body: { kind, id, title, hidden },
  });
  notifyAll();
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export const deleteReview = async (_admin: AdminCtx, r: { id: string; businessId: string; authorName: string }) => {
  await apiFetch(`/api/v1/admin/reviews/${encodeURIComponent(r.id)}`, {
    method: 'DELETE',
  });
  notifyAll();
};

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface TargetInfo {
  kind: 'community' | 'builtin' | 'missing';
  title: string;
  status?: string;
  ownerId?: string;
  ownerName?: string;
  excerpt?: string;
  ownerIsAdmin?: boolean;
}

interface ServerTargetResponse {
  target: {
    kind: 'community' | 'not_in_d1' | 'missing';
    title: string;
    status?: string;
    ownerId?: string;
    ownerName?: string;
    excerpt?: string;
    ownerIsAdmin?: boolean;
  };
}

/** Looks up the reported item. Authoritative ownership comes from D1 or bundled seed lookups. */
export async function loadTarget(report: ReportRecord): Promise<TargetInfo> {
  try {
    const { target } = await apiFetch<ServerTargetResponse>(
      `/api/v1/admin/reports/${encodeURIComponent(report.id)}/target`,
    );
    if (target.kind === 'community') {
      return {
        kind: 'community',
        title: target.title,
        status: target.status,
        ownerId: target.ownerId,
        ownerName: target.ownerName,
        excerpt: target.excerpt,
        ownerIsAdmin: target.ownerIsAdmin === true,
      };
    }
    if (target.kind === 'not_in_d1') {
      if (report.targetType === 'business') {
        const seed = seedBusiness(report.targetId);
        return seed ? { kind: 'builtin', title: seed.name, excerpt: seed.description, ownerIsAdmin: false } : { kind: 'missing', title: report.targetTitle, ownerIsAdmin: false };
      }
      if (report.targetType === 'ad') {
        const seed = seedAd(report.targetId);
        return seed ? { kind: 'builtin', title: seed.title, excerpt: seed.description, ownerIsAdmin: false } : { kind: 'missing', title: report.targetTitle, ownerIsAdmin: false };
      }
    }
    return { kind: 'missing', title: target.title || report.targetTitle, ownerIsAdmin: false };
  } catch (err) {
    logError('load report target', err);
    return { kind: 'missing', title: report.targetTitle, ownerIsAdmin: false };
  }
}

export async function actOnReport(
  _admin: AdminCtx,
  report: ReportRecord,
  target: TargetInfo,
  outcome: {
    status: 'resolved' | 'dismissed';
    note: string;
    removeContent?: boolean;
    banOwner?: { reason: string; email?: string; name?: string };
  },
): Promise<void> {
  await apiFetch(`/api/v1/admin/reports/${encodeURIComponent(report.id)}/action`, {
    method: 'POST',
    body: {
      status: outcome.status,
      note: cleanText(outcome.note, 500),
      removeContent: !!outcome.removeContent,
      targetKindHint: target.kind,
      targetTitleHint: target.title,
      banOwner: outcome.banOwner
        ? {
            reason: cleanText(outcome.banOwner.reason, 500),
            email: outcome.banOwner.email,
            name: outcome.banOwner.name,
          }
        : undefined,
    },
  });
  notifyAll();
}

// ---------------------------------------------------------------------------
// Ownership claims
// ---------------------------------------------------------------------------

export async function approveClaim(_admin: AdminCtx, claim: ClaimRecord, note: string): Promise<'community' | 'builtin'> {
  const res = await apiFetch<{ targetKind: 'community' | 'builtin' }>(
    `/api/v1/admin/claims/${encodeURIComponent(claim.id)}/approve`,
    {
      method: 'POST',
      body: { note: cleanText(note, 500) },
    },
  );
  notifyAll();
  return res.targetKind;
}

export const rejectClaim = async (_admin: AdminCtx, claim: ClaimRecord, note: string) => {
  await apiFetch(`/api/v1/admin/claims/${encodeURIComponent(claim.id)}/reject`, {
    method: 'POST',
    body: { note: cleanText(note, 500) },
  });
  notifyAll();
};

// ---------------------------------------------------------------------------
// Users, bans and admins
// ---------------------------------------------------------------------------

export async function banUser(
  _admin: AdminCtx,
  user: { id: string; email: string; displayName: string },
  reason: string,
  removeContent: boolean,
): Promise<{ removed: number }> {
  const res = await apiFetch<{ removed: number }>(
    `/api/v1/admin/users/${encodeURIComponent(user.id)}/ban`,
    {
      method: 'POST',
      body: {
        reason: cleanText(reason, 500),
        removeContent,
        email: cleanText(user.email, 150),
        displayName: cleanText(user.displayName, 100),
      },
    },
  );
  notifyAll();
  return res;
}

export const unbanUser = async (_admin: AdminCtx, user: { id: string; email: string }) => {
  await apiFetch(`/api/v1/admin/users/${encodeURIComponent(user.id)}/unban`, {
    method: 'POST',
    body: {},
  });
  notifyAll();
};

export const grantAdmin = async (_admin: AdminCtx, user: { id: string; email: string }) => {
  await apiFetch(`/api/v1/admin/users/${encodeURIComponent(user.id)}/grant-admin`, {
    method: 'POST',
    body: {},
  });
  notifyAll();
};

export const revokeAdmin = async (_admin: AdminCtx, user: { id: string; email?: string }) => {
  await apiFetch(`/api/v1/admin/users/${encodeURIComponent(user.id)}/revoke-admin`, {
    method: 'POST',
    body: {},
  });
  notifyAll();
};

/** A member's content, for the "view activity" panel before deciding on a ban. */
export async function loadUserActivity(uid: string) {
  return apiFetch<{ businesses: Business[]; ads: MarketplaceItem[]; reviews: ReviewRow[] }>(
    `/api/v1/admin/users/${encodeURIComponent(uid)}/activity`,
  );
}

// ---------------------------------------------------------------------------
// Messages, subscribers, settings
// ---------------------------------------------------------------------------

export const setMessageStatus = async (_admin: AdminCtx, id: string, status: 'new' | 'read' | 'archived') => {
  await apiFetch(`/api/v1/admin/messages/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { status },
  });
  notifyAll();
};

export const deleteMessage = async (_admin: AdminCtx, m: MessageRow) => {
  await apiFetch(`/api/v1/admin/messages/${encodeURIComponent(m.id)}`, {
    method: 'DELETE',
  });
  notifyAll();
};

export const deleteSubscriber = async (_admin: AdminCtx, s: SubscriberRow) => {
  await apiFetch(`/api/v1/admin/subscribers/${encodeURIComponent(s.id)}`, {
    method: 'DELETE',
  });
  notifyAll();
};

export async function saveSettings(_admin: AdminCtx, s: SiteSettings) {
  const email = s.contactEmail.trim();
  if (email && !cleanEmail(email)) throw new Error('The contact email address is not valid.');
  const clean = {
    contactEmail: email.toLowerCase(),
    contactPhone: cleanText(s.contactPhone, 40),
    whatsapp: cleanText(s.whatsapp, 40),
    address: cleanText(s.address, 300),
    officeHours: cleanText(s.officeHours, 200),
    aboutStory: cleanMultiline(s.aboutStory, 5000),
    announcementEnabled: !!s.announcementEnabled && cleanText(s.announcementText, 300).length > 0,
    announcementText: cleanText(s.announcementText, 300),
    adsNeedApproval: !!s.adsNeedApproval,
  };
  await apiFetch('/api/v1/admin/settings', {
    method: 'PUT',
    body: clean,
  });
  notifyAll();
}
