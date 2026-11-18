/**
 * Public site data = bundled directory/marketplace seed data
 *                  + community listings and ads from Firestore (approved/active only)
 *                  − anything an admin has hidden, + admin verification flags.
 *
 * If Firestore is unreachable (offline, or rules not deployed yet) the site
 * keeps working with the bundled data and exposes `error` instead of crashing.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { collection, doc, limit, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { COL, DEFAULT_SETTINGS, MAX_PUBLIC_DOCS, SITE_SETTINGS_DOC } from '../lib/config';
import { cleanMultiline, cleanText } from '../lib/security';
import { logError } from '../lib/errors';
import { adFromSnap, businessFromSnap } from '../services/content';
import { INITIAL_BUSINESSES } from '../data/nigeriaData';
import { INITIAL_MARKETPLACE_ITEMS } from '../data/marketplaceData';
import { Business, ListingOverride, MarketplaceItem, SiteSettings } from '../types';

interface DataContextType {
  businesses: Business[];
  marketplaceItems: MarketplaceItem[];
  settings: SiteSettings;
  communityBusinessCount: number;
  communityAdCount: number;
  /** True once the first Firestore responses (or errors) have arrived. */
  ready: boolean;
  /** Set when community content could not be loaded; the bundled data still works. */
  error: string | null;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

function readSettings(raw: Record<string, unknown> | undefined): SiteSettings {
  const r = raw ?? {};
  return {
    contactEmail: cleanText(r.contactEmail, 150),
    contactPhone: cleanText(r.contactPhone, 40),
    whatsapp: cleanText(r.whatsapp, 40),
    address: cleanText(r.address, 300),
    officeHours: cleanText(r.officeHours, 200),
    aboutStory: cleanMultiline(r.aboutStory, 5000),
    announcementEnabled: r.announcementEnabled === true,
    announcementText: cleanText(r.announcementText, 300),
    adsNeedApproval: r.adsNeedApproval === true,
  };
}

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [communityBusinesses, setCommunityBusinesses] = useState<Business[]>([]);
  const [communityAds, setCommunityAds] = useState<MarketplaceItem[]>([]);
  const [overrides, setOverrides] = useState<ListingOverride[]>([]);
  const [settings, setSettings] = useState<SiteSettings>({ ...DEFAULT_SETTINGS });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(4); // listeners that haven't answered yet

  useEffect(() => {
    // Each listener counts as "ready" once, on its first answer (data or error).
    const answered = new Set<string>();
    const markReady = (key: string) => {
      if (answered.has(key)) return;
      answered.add(key);
      setPending((p) => Math.max(0, p - 1));
    };
    const onError = (key: string) => (err: unknown) => {
      logError(`load ${key}`, err);
      setError('Some community content could not be loaded right now.');
      markReady(key);
    };

    const unsubs = [
      onSnapshot(
        query(collection(db, COL.businesses), where('status', '==', 'approved'), limit(MAX_PUBLIC_DOCS)),
        (snap) => {
          setCommunityBusinesses(snap.docs.map(businessFromSnap).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)));
          markReady('businesses');
        },
        onError('businesses'),
      ),
      onSnapshot(
        query(collection(db, COL.marketplace), where('status', '==', 'active'), limit(MAX_PUBLIC_DOCS)),
        (snap) => {
          setCommunityAds(snap.docs.map(adFromSnap).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)));
          markReady('ads');
        },
        onError('ads'),
      ),
      onSnapshot(
        collection(db, COL.overrides),
        (snap) => {
          setOverrides(
            snap.docs.map((d) => {
              const v = d.data() as Record<string, unknown>;
              const kind = v.kind === 'marketplace' ? 'marketplace' : 'business';
              return {
                // Document ids are "<kind>_<listing id>" so a business id can never collide with an ad id.
                id: d.id.startsWith(`${kind}_`) ? d.id.slice(kind.length + 1) : d.id,
                kind,
                hidden: v.hidden === true,
                verified: v.verified === true,
                claimedBy: typeof v.claimedBy === 'string' ? v.claimedBy : undefined,
              } satisfies ListingOverride;
            }),
          );
          markReady('overrides');
        },
        onError('overrides'),
      ),
      onSnapshot(
        doc(db, COL.settings, SITE_SETTINGS_DOC),
        (snap) => {
          setSettings(readSettings(snap.exists() ? (snap.data() as Record<string, unknown>) : undefined));
          markReady('settings');
        },
        onError('settings'),
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const businesses = useMemo(() => {
    const hidden = new Set<string>();
    const flagged = new Map<string, ListingOverride>();
    overrides.forEach((o) => {
      if (o.kind !== 'business') return;
      if (o.hidden) hidden.add(o.id);
      else if (o.verified || o.claimedBy) flagged.set(o.id, o);
    });

    const seeds =
      hidden.size === 0 && flagged.size === 0
        ? INITIAL_BUSINESSES
        : INITIAL_BUSINESSES.filter((b) => !hidden.has(b.id)).map((b) => {
            const f = flagged.get(b.id);
            return f ? { ...b, isVerified: b.isVerified || !!f.verified, claimed: !!f.claimedBy } : b;
          });

    return [...communityBusinesses, ...seeds];
  }, [communityBusinesses, overrides]);

  const marketplaceItems = useMemo(() => {
    const hidden = new Set(overrides.filter((o) => o.kind === 'marketplace' && o.hidden).map((o) => o.id));
    const ownBusinessById = new Map(communityBusinesses.map((b) => [b.id, b]));

    // A community ad is only a "verified seller" if the business it is linked to has been verified by an admin.
    const ads = communityAds.map((ad) => ({
      ...ad,
      isVerifiedSeller: ad.businessId ? ownBusinessById.get(ad.businessId)?.isVerified === true : false,
    }));
    const seeds = hidden.size ? INITIAL_MARKETPLACE_ITEMS.filter((i) => !hidden.has(i.id)) : INITIAL_MARKETPLACE_ITEMS;
    return [...ads, ...seeds];
  }, [communityAds, communityBusinesses, overrides]);

  const value = useMemo<DataContextType>(
    () => ({
      businesses,
      marketplaceItems,
      settings,
      communityBusinessCount: communityBusinesses.length,
      communityAdCount: communityAds.length,
      ready: pending === 0,
      error,
    }),
    [businesses, marketplaceItems, settings, communityBusinesses.length, communityAds.length, pending, error],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export const useData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within a DataProvider');
  return ctx;
};
