/**
 * Everything the admin site reads and writes.
 *
 * Every change goes through `commit()`, which writes the change and its audit-log
 * entry in ONE atomic batch, so there is never a change without a record of who
 * made it. firestore.rules independently checks that the caller is an admin.
 */
import { DependencyList, useEffect, useState } from 'react';
import {
  DocumentData,
  Query,
  QueryDocumentSnapshot,
  WriteBatch,
  collection,
  deleteField,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { COL, LIMITS, MAX_ADMIN_DOCS, SITE_SETTINGS_DOC } from '../lib/config';
import { friendlyError, logError } from '../lib/errors';
import { cleanEmail, cleanMultiline, cleanPhone, cleanText, compact, safeHttpUrl } from '../lib/security';
import { adFromSnap, businessFromSnap, claimFromSnap, toMillis } from '../services/content';
import { INITIAL_BUSINESSES } from '../data/nigeriaData';
import { INITIAL_MARKETPLACE_ITEMS } from '../data/marketplaceData';
import { Business, ClaimRecord, ListingOverride, MarketplaceItem, ReportRecord, SiteSettings } from '../types';

export { adFromSnap, businessFromSnap, claimFromSnap };

export interface AdminCtx {
  uid: string;
  email: string;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Snap = QueryDocumentSnapshot<DocumentData>;

export interface UserRow { id: string; email: string; displayName: string; createdAt?: number }
export interface BanRow { id: string; reason?: string; email?: string; name?: string; bannedAt?: number; bannedBy?: string }
export interface AdminRow { id: string; email?: string; addedAt?: number }
export interface MessageRow { id: string; name: string; email: string; subject: string; message: string; status: 'new' | 'read' | 'archived'; createdAt?: number; uid?: string }
export interface SubscriberRow { id: string; email: string; subscribedAt?: number; source?: string }
export interface AuditRow { id: string; adminEmail: string; action: string; targetType?: string; targetId?: string; summary?: string; createdAt?: number }
export interface ReviewRow { id: string; businessId: string; authorId: string; authorName: string; rating: number; comment: string; createdAt?: number }

const str = (v: unknown, max = 500) => cleanText(v, max);

export const userFromSnap = (s: Snap): UserRow => {
  const d = s.data() as Raw;
  return { id: s.id, email: str(d.email, 150), displayName: str(d.displayName, 100), createdAt: toMillis(d.createdAt) };
};
export const banFromSnap = (s: Snap): BanRow => {
  const d = s.data() as Raw;
  return { id: s.id, reason: str(d.reason) || undefined, email: str(d.email, 150) || undefined, name: str(d.name, 100) || undefined, bannedAt: toMillis(d.bannedAt), bannedBy: d.bannedBy };
};
export const adminFromSnap = (s: Snap): AdminRow => {
  const d = s.data() as Raw;
  return { id: s.id, email: str(d.email, 150) || undefined, addedAt: toMillis(d.addedAt) };
};
export const messageFromSnap = (s: Snap): MessageRow => {
  const d = s.data({ serverTimestamps: 'estimate' }) as Raw;
  return {
    id: s.id,
    name: str(d.name, 100),
    email: str(d.email, 150),
    subject: str(d.subject, 200),
    message: cleanMultiline(d.message, LIMITS.contactMessage),
    status: d.status === 'read' || d.status === 'archived' ? d.status : 'new',
    createdAt: toMillis(d.createdAt),
    uid: typeof d.uid === 'string' ? d.uid : undefined,
  };
};
export const subscriberFromSnap = (s: Snap): SubscriberRow => {
  const d = s.data() as Raw;
  return { id: s.id, email: str(d.email, 150), subscribedAt: toMillis(d.subscribedAt), source: str(d.source, 60) || undefined };
};
export const auditFromSnap = (s: Snap): AuditRow => {
  const d = s.data({ serverTimestamps: 'estimate' }) as Raw;
  return {
    id: s.id,
    adminEmail: str(d.adminEmail, 150),
    action: str(d.action, 60),
    targetType: str(d.targetType, 40) || undefined,
    targetId: str(d.targetId, 300) || undefined,
    summary: str(d.summary) || undefined,
    createdAt: toMillis(d.createdAt),
  };
};
export const reviewFromSnap = (s: Snap): ReviewRow => {
  const d = s.data({ serverTimestamps: 'estimate' }) as Raw;
  return {
    id: s.id,
    businessId: str(d.businessId, 100),
    authorId: str(d.authorId, 128),
    authorName: str(d.authorName, 100),
    rating: Math.min(5, Math.max(1, Math.round(Number(d.rating) || 1))),
    comment: cleanMultiline(d.comment, LIMITS.review),
    createdAt: toMillis(d.createdAt),
  };
};
export const reportFromSnap = (s: Snap): ReportRecord => {
  const d = s.data({ serverTimestamps: 'estimate' }) as Raw;
  return {
    id: s.id,
    targetType: d.targetType,
    targetId: str(d.targetId, 300),
    targetTitle: str(d.targetTitle, 150),
    reason: d.reason,
    details: cleanMultiline(d.details, LIMITS.reportDetails) || undefined,
    reporterId: str(d.reporterId, 128),
    reporterName: str(d.reporterName, 100) || undefined,
    status: d.status === 'resolved' || d.status === 'dismissed' ? d.status : 'open',
    createdAt: toMillis(d.createdAt),
    resolution: str(d.resolution) || undefined,
    resolvedBy: d.resolvedBy,
    resolvedAt: toMillis(d.resolvedAt),
  };
};

// ---------------------------------------------------------------------------
// Live queries
// ---------------------------------------------------------------------------

export const recent = (col: string, field = 'createdAt', max = MAX_ADMIN_DOCS) =>
  query(collection(db, col), orderBy(field, 'desc'), limit(max));

export function useLive<T>(
  factory: () => Query<DocumentData> | null,
  map: (s: Snap) => T,
  deps: DependencyList,
): { data: T[]; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ data: T[]; loading: boolean; error: string | null }>({ data: [], loading: true, error: null });

  useEffect(() => {
    const q = factory();
    if (!q) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      q,
      (snap) => setState({ data: snap.docs.map(map), loading: false, error: null }),
      (err) => {
        logError('admin live query', err);
        setState({ data: [], loading: false, error: friendlyError(err, 'Could not load this data.') });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

export async function countOf(q: Query<DocumentData>): Promise<number> {
  try {
    return (await getCountFromServer(q)).data().count;
  } catch (err) {
    logError('count', err);
    return 0;
  }
}

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

// ---------------------------------------------------------------------------
// Audited batch writes
// ---------------------------------------------------------------------------

export interface AuditEntry {
  action: string;
  targetType?: string;
  targetId?: string;
  summary?: string;
}

type Builder = (batch: WriteBatch, log: (e: AuditEntry) => void) => void;

export async function commit(admin: AdminCtx, build: Builder): Promise<void> {
  const batch = writeBatch(db);
  const log = (e: AuditEntry) =>
    batch.set(
      doc(collection(db, COL.audit)),
      compact({
        adminId: admin.uid,
        adminEmail: cleanText(admin.email, 150),
        action: cleanText(e.action, 60),
        targetType: e.targetType,
        targetId: e.targetId ? cleanText(e.targetId, 300) : undefined,
        summary: e.summary ? cleanText(e.summary, 500) : undefined,
        createdAt: serverTimestamp(),
      }),
    );
  build(batch, log);
  await batch.commit();
}

const stamp = (admin: AdminCtx) => ({ reviewedBy: admin.uid, reviewedAt: serverTimestamp() });

// ---------------------------------------------------------------------------
// Businesses (community listings)
// ---------------------------------------------------------------------------

export const approveBusiness = (admin: AdminCtx, b: Business, verify: boolean) =>
  commit(admin, (batch, log) => {
    batch.update(doc(db, COL.businesses, b.id), {
      status: 'approved',
      ...(verify ? { isVerified: true } : {}),
      moderationNote: deleteField(),
      ...stamp(admin),
    });
    log({ action: verify ? 'business.approve_verify' : 'business.approve', targetType: 'business', targetId: b.id, summary: b.name });
  });

export const rejectBusiness = (admin: AdminCtx, b: Business, note: string) =>
  commit(admin, (batch, log) => {
    batch.update(doc(db, COL.businesses, b.id), { status: 'rejected', moderationNote: cleanText(note, 500), ...stamp(admin) });
    log({ action: 'business.reject', targetType: 'business', targetId: b.id, summary: `${b.name}: ${note}` });
  });

export const removeBusiness = (admin: AdminCtx, b: Business, note: string) =>
  commit(admin, (batch, log) => {
    batch.update(doc(db, COL.businesses, b.id), { status: 'removed', moderationNote: cleanText(note, 500), ...stamp(admin) });
    log({ action: 'business.remove', targetType: 'business', targetId: b.id, summary: `${b.name}: ${note}` });
  });

export const restoreBusiness = (admin: AdminCtx, b: Business) =>
  commit(admin, (batch, log) => {
    batch.update(doc(db, COL.businesses, b.id), { status: 'approved', moderationNote: deleteField(), ...stamp(admin) });
    log({ action: 'business.restore', targetType: 'business', targetId: b.id, summary: b.name });
  });

export const setBusinessVerified = (admin: AdminCtx, b: Business, verified: boolean) =>
  commit(admin, (batch, log) => {
    batch.update(doc(db, COL.businesses, b.id), { isVerified: verified, ...stamp(admin) });
    log({ action: verified ? 'business.verify' : 'business.unverify', targetType: 'business', targetId: b.id, summary: b.name });
  });

export const deleteBusinessForever = (admin: AdminCtx, b: Business) =>
  commit(admin, (batch, log) => {
    batch.delete(doc(db, COL.businesses, b.id));
    log({ action: 'business.delete', targetType: 'business', targetId: b.id, summary: b.name });
  });

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

/** Light-touch corrections by an admin (typos, formatting). Cleared optional fields are removed. */
export const editBusiness = (admin: AdminCtx, b: Business, e: BusinessEdit) => {
  const name = cleanText(e.name, LIMITS.name);
  if (name.length < 2) throw new Error('The business name is too short.');
  const phone = cleanPhone(e.phone);
  if (!phone) throw new Error('The phone number is not valid.');
  const whatsapp = e.whatsapp.trim() ? cleanPhone(e.whatsapp) : undefined;
  if (e.whatsapp.trim() && !whatsapp) throw new Error('The WhatsApp number is not valid.');
  const email = e.email.trim() ? cleanEmail(e.email) : undefined;
  if (e.email.trim() && !email) throw new Error('The email address is not valid.');
  const website = e.website.trim() ? safeHttpUrl(e.website.trim().replace(/^http:\/\//i, 'https://'), { httpsOnly: true, max: LIMITS.url }) : undefined;
  if (e.website.trim() && !website) throw new Error('The website address is not valid.');

  const opt = (v: string | undefined) => (v ? v : deleteField());
  return commit(admin, (batch, log) => {
    batch.update(doc(db, COL.businesses, b.id), {
      name,
      category: cleanText(e.category, LIMITS.category) || b.category,
      state: cleanText(e.state, LIMITS.state) || b.state,
      lga: cleanText(e.lga, LIMITS.lga) || b.lga,
      address: cleanText(e.address, LIMITS.address) || b.address,
      phone,
      whatsapp: opt(whatsapp),
      email: opt(email),
      website: opt(website),
      openingHours: opt(cleanText(e.openingHours, LIMITS.hours)),
      description: opt(cleanMultiline(e.description, LIMITS.description)),
    });
    log({ action: 'business.edit', targetType: 'business', targetId: b.id, summary: name });
  });
};

// ---------------------------------------------------------------------------
// Marketplace ads
// ---------------------------------------------------------------------------

export const approveAd = (admin: AdminCtx, a: MarketplaceItem) =>
  commit(admin, (batch, log) => {
    batch.update(doc(db, COL.marketplace, a.id), { status: 'active', moderationNote: deleteField(), ...stamp(admin) });
    log({ action: 'ad.approve', targetType: 'ad', targetId: a.id, summary: a.title });
  });

export const removeAd = (admin: AdminCtx, a: MarketplaceItem, note: string) =>
  commit(admin, (batch, log) => {
    batch.update(doc(db, COL.marketplace, a.id), { status: 'removed', moderationNote: cleanText(note, 500), ...stamp(admin) });
    log({ action: 'ad.remove', targetType: 'ad', targetId: a.id, summary: `${a.title}: ${note}` });
  });

export const restoreAd = (admin: AdminCtx, a: MarketplaceItem) =>
  commit(admin, (batch, log) => {
    batch.update(doc(db, COL.marketplace, a.id), { status: 'active', moderationNote: deleteField(), ...stamp(admin) });
    log({ action: 'ad.restore', targetType: 'ad', targetId: a.id, summary: a.title });
  });

export const deleteAdForever = (admin: AdminCtx, a: MarketplaceItem) =>
  commit(admin, (batch, log) => {
    batch.delete(doc(db, COL.marketplace, a.id));
    log({ action: 'ad.delete', targetType: 'ad', targetId: a.id, summary: a.title });
  });

// ---------------------------------------------------------------------------
// Built-in (seed) listings: hide / restore through listing_overrides
// ---------------------------------------------------------------------------

export function setSeedHidden(
  admin: AdminCtx,
  kind: 'business' | 'marketplace',
  id: string,
  title: string,
  hidden: boolean,
  existing?: ListingOverride,
) {
  return commit(admin, (batch, log) => {
    const ref = doc(db, COL.overrides, overrideDocId(kind, id));
    const keep = !hidden && (existing?.verified || existing?.claimedBy);
    if (hidden || keep) {
      batch.set(
        ref,
        compact({
          kind,
          hidden,
          verified: existing?.verified ? true : undefined,
          claimedBy: existing?.claimedBy,
          updatedBy: admin.uid,
          updatedAt: serverTimestamp(),
        }),
      );
    } else {
      batch.delete(ref);
    }
    log({ action: hidden ? `${kind}.hide_builtin` : `${kind}.restore_builtin`, targetType: kind === 'business' ? 'business' : 'ad', targetId: id, summary: title });
  });
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export const deleteReview = (admin: AdminCtx, r: { id: string; businessId: string; authorName: string }) =>
  commit(admin, (batch, log) => {
    batch.delete(doc(db, COL.reviews, r.id));
    log({ action: 'review.delete', targetType: 'review', targetId: r.id, summary: `by ${r.authorName} on ${r.businessId}` });
  });

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
}

/** Looks up the reported item. The owner comes from the *item itself*, never from what the reporter claimed. */
export async function loadTarget(report: ReportRecord): Promise<TargetInfo> {
  try {
    if (report.targetType === 'business') {
      const snap = await getDoc(doc(db, COL.businesses, report.targetId));
      if (snap.exists()) {
        const b = businessFromSnap(snap);
        return { kind: 'community', title: b.name, status: b.status, ownerId: b.ownerId, ownerName: b.ownerName, excerpt: b.description };
      }
      const seed = seedBusiness(report.targetId);
      return seed ? { kind: 'builtin', title: seed.name, excerpt: seed.description } : { kind: 'missing', title: report.targetTitle };
    }
    if (report.targetType === 'ad') {
      const snap = await getDoc(doc(db, COL.marketplace, report.targetId));
      if (snap.exists()) {
        const a = adFromSnap(snap);
        return { kind: 'community', title: a.title, status: a.status, ownerId: a.ownerId, ownerName: a.ownerName, excerpt: a.description };
      }
      const seed = seedAd(report.targetId);
      return seed ? { kind: 'builtin', title: seed.title, excerpt: seed.description } : { kind: 'missing', title: report.targetTitle };
    }
    const snap = await getDoc(doc(db, COL.reviews, report.targetId));
    if (snap.exists()) {
      const r = reviewFromSnap(snap as Snap);
      return { kind: 'community', title: report.targetTitle, ownerId: r.authorId, ownerName: r.authorName, excerpt: r.comment };
    }
    return { kind: 'missing', title: report.targetTitle };
  } catch (err) {
    logError('load report target', err);
    return { kind: 'missing', title: report.targetTitle };
  }
}

/**
 * Applies the chosen outcome to a report in one atomic batch:
 *  - optionally removes the reported content,
 *  - optionally suspends its owner,
 *  - and closes the report with a resolution note.
 */
export async function actOnReport(
  admin: AdminCtx,
  report: ReportRecord,
  target: TargetInfo,
  outcome: { status: 'resolved' | 'dismissed'; note: string; removeContent?: boolean; banOwner?: { reason: string; email?: string; name?: string } },
): Promise<void> {
  await commit(admin, (batch, log) => {
    if (outcome.removeContent && target.kind !== 'missing') {
      const note = outcome.note || 'Removed after a report';
      if (report.targetType === 'business') {
        if (target.kind === 'community') batch.update(doc(db, COL.businesses, report.targetId), { status: 'removed', moderationNote: cleanText(note, 500), ...stamp(admin) });
        else batch.set(doc(db, COL.overrides, overrideDocId('business', report.targetId)), { kind: 'business', hidden: true, updatedBy: admin.uid, updatedAt: serverTimestamp() });
      } else if (report.targetType === 'ad') {
        if (target.kind === 'community') batch.update(doc(db, COL.marketplace, report.targetId), { status: 'removed', moderationNote: cleanText(note, 500), ...stamp(admin) });
        else batch.set(doc(db, COL.overrides, overrideDocId('marketplace', report.targetId)), { kind: 'marketplace', hidden: true, updatedBy: admin.uid, updatedAt: serverTimestamp() });
      } else {
        batch.delete(doc(db, COL.reviews, report.targetId));
      }
      log({ action: `${report.targetType}.remove_via_report`, targetType: report.targetType, targetId: report.targetId, summary: target.title });
    }

    if (outcome.banOwner && target.ownerId) {
      batch.set(
        doc(db, COL.bans, target.ownerId),
        compact({
          reason: cleanText(outcome.banOwner.reason, 500),
          email: outcome.banOwner.email,
          name: outcome.banOwner.name,
          bannedBy: admin.uid,
          bannedAt: serverTimestamp(),
        }),
      );
      log({ action: 'user.ban', targetType: 'user', targetId: target.ownerId, summary: outcome.banOwner.reason });
    }

    batch.update(doc(db, COL.reports, report.id), {
      status: outcome.status,
      resolution: cleanText(outcome.note, 500),
      resolvedBy: admin.uid,
      resolvedAt: serverTimestamp(),
    });
    log({ action: outcome.status === 'dismissed' ? 'report.dismiss' : 'report.resolve', targetType: 'report', targetId: report.id, summary: `${report.targetTitle}: ${outcome.note}` });
  });
}

// ---------------------------------------------------------------------------
// Ownership claims
// ---------------------------------------------------------------------------

export async function approveClaim(admin: AdminCtx, claim: ClaimRecord, note: string): Promise<'community' | 'builtin'> {
  const bizSnap = await getDoc(doc(db, COL.businesses, claim.businessId));
  const isCommunity = bizSnap.exists();

  await commit(admin, (batch, log) => {
    if (isCommunity) {
      batch.update(doc(db, COL.businesses, claim.businessId), { isVerified: true, claimed: true, ...stamp(admin) });
    } else {
      batch.set(doc(db, COL.overrides, overrideDocId('business', claim.businessId)), {
        kind: 'business',
        hidden: false,
        verified: true,
        claimedBy: claim.claimantId,
        updatedBy: admin.uid,
        updatedAt: serverTimestamp(),
      });
    }
    batch.update(doc(db, COL.claims, claim.id), {
      status: 'approved',
      reviewNote: cleanText(note, 500),
      reviewedBy: admin.uid,
      reviewedAt: serverTimestamp(),
    });
    log({ action: 'claim.approve', targetType: 'claim', targetId: claim.id, summary: `${claim.businessName} → ${claim.name}` });
  });
  return isCommunity ? 'community' : 'builtin';
}

export const rejectClaim = (admin: AdminCtx, claim: ClaimRecord, note: string) =>
  commit(admin, (batch, log) => {
    batch.update(doc(db, COL.claims, claim.id), {
      status: 'rejected',
      reviewNote: cleanText(note, 500),
      reviewedBy: admin.uid,
      reviewedAt: serverTimestamp(),
    });
    log({ action: 'claim.reject', targetType: 'claim', targetId: claim.id, summary: `${claim.businessName}: ${note}` });
  });

// ---------------------------------------------------------------------------
// Users, bans and admins
// ---------------------------------------------------------------------------

const CHUNK = 150;

export async function banUser(
  admin: AdminCtx,
  user: { id: string; email: string; displayName: string },
  reason: string,
  removeContent: boolean,
): Promise<{ removed: number }> {
  let businesses: Snap[] = [];
  let ads: Snap[] = [];
  let reviews: Snap[] = [];
  if (removeContent) {
    const [b, a, r] = await Promise.all([
      getDocs(query(collection(db, COL.businesses), where('ownerId', '==', user.id), limit(CHUNK))),
      getDocs(query(collection(db, COL.marketplace), where('ownerId', '==', user.id), limit(CHUNK))),
      getDocs(query(collection(db, COL.reviews), where('authorId', '==', user.id), limit(CHUNK))),
    ]);
    businesses = b.docs;
    ads = a.docs;
    reviews = r.docs;
  }

  await commit(admin, (batch, log) => {
    batch.set(
      doc(db, COL.bans, user.id),
      compact({
        reason: cleanText(reason, 500),
        email: cleanText(user.email, 150),
        name: cleanText(user.displayName, 100),
        bannedBy: admin.uid,
        bannedAt: serverTimestamp(),
      }),
    );
    const note = 'Removed: the account that posted this was suspended.';
    businesses.forEach((s) => batch.update(s.ref, { status: 'removed', moderationNote: note, ...stamp(admin) }));
    ads.forEach((s) => batch.update(s.ref, { status: 'removed', moderationNote: note, ...stamp(admin) }));
    reviews.forEach((s) => batch.delete(s.ref));
    log({
      action: 'user.ban',
      targetType: 'user',
      targetId: user.id,
      summary: `${user.email || user.displayName}: ${reason}${removeContent ? ` (removed ${businesses.length} listings, ${ads.length} ads, ${reviews.length} reviews)` : ''}`,
    });
  });
  return { removed: businesses.length + ads.length + reviews.length };
}

export const unbanUser = (admin: AdminCtx, user: { id: string; email: string }) =>
  commit(admin, (batch, log) => {
    batch.delete(doc(db, COL.bans, user.id));
    log({ action: 'user.unban', targetType: 'user', targetId: user.id, summary: user.email });
  });

export const grantAdmin = (admin: AdminCtx, user: { id: string; email: string }) =>
  commit(admin, (batch, log) => {
    batch.set(
      doc(db, COL.admins, user.id),
      compact({ email: cleanText(user.email, 150), addedBy: admin.uid, addedAt: serverTimestamp() }),
    );
    log({ action: 'admin.grant', targetType: 'user', targetId: user.id, summary: user.email });
  });

export const revokeAdmin = (admin: AdminCtx, user: { id: string; email?: string }) =>
  commit(admin, (batch, log) => {
    batch.delete(doc(db, COL.admins, user.id));
    log({ action: 'admin.revoke', targetType: 'user', targetId: user.id, summary: user.email });
  });

/** A member's content, for the "view activity" panel before deciding on a ban. */
export async function loadUserActivity(uid: string) {
  const [b, a, r] = await Promise.all([
    getDocs(query(collection(db, COL.businesses), where('ownerId', '==', uid), limit(50))),
    getDocs(query(collection(db, COL.marketplace), where('ownerId', '==', uid), limit(50))),
    getDocs(query(collection(db, COL.reviews), where('authorId', '==', uid), limit(50))),
  ]);
  return {
    businesses: b.docs.map(businessFromSnap),
    ads: a.docs.map(adFromSnap),
    reviews: r.docs.map((d) => reviewFromSnap(d as Snap)),
  };
}

// ---------------------------------------------------------------------------
// Messages, subscribers, settings
// ---------------------------------------------------------------------------

export const setMessageStatus = (admin: AdminCtx, id: string, status: 'new' | 'read' | 'archived') =>
  commit(admin, (batch) => {
    batch.update(doc(db, COL.contactMessages, id), { status });
  });

export const deleteMessage = (admin: AdminCtx, m: MessageRow) =>
  commit(admin, (batch, log) => {
    batch.delete(doc(db, COL.contactMessages, m.id));
    log({ action: 'message.delete', targetType: 'message', targetId: m.id, summary: m.subject });
  });

export const deleteSubscriber = (admin: AdminCtx, s: SubscriberRow) =>
  commit(admin, (batch, log) => {
    batch.delete(doc(db, COL.subscribers, s.id));
    log({ action: 'subscriber.delete', targetType: 'subscriber', targetId: s.id, summary: s.email });
  });

export function saveSettings(admin: AdminCtx, s: SiteSettings) {
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
  return commit(admin, (batch, log) => {
    batch.set(doc(db, COL.settings, SITE_SETTINGS_DOC), { ...clean, updatedAt: serverTimestamp(), updatedBy: admin.uid });
    log({ action: 'settings.update', targetType: 'settings', targetId: SITE_SETTINGS_DOC, summary: `Ads need approval: ${clean.adsNeedApproval ? 'on' : 'off'}; announcement: ${clean.announcementEnabled ? 'on' : 'off'}` });
  });
}
