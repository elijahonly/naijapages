/**
 * Public site data loaded from Cloudflare D1 (`/api/v1/directory/bootstrap`):
 * approved member businesses, active marketplace ads, admin moderation overrides, and site settings.
 *
 * If the backend API is temporarily unreachable, the context exposes `error` + `refresh()`
 * instead of crashing.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_SETTINGS } from '../lib/config';
import { DATA_REFRESH_EVENT } from '../lib/apiClient';
import { logError } from '../lib/errors';
import { INITIAL_BUSINESSES } from '../data/nigeriaData';
import { INITIAL_MARKETPLACE_ITEMS } from '../data/marketplaceData';
import {
  fetchDirectoryBootstrap,
  mergeCommunityAndSeedAds,
  mergeCommunityAndSeedBusinesses,
} from '../services/directory';
import { Business, ListingOverride, MarketplaceItem, SiteSettings } from '../types';

interface DataContextType {
  businesses: Business[];
  marketplaceItems: MarketplaceItem[];
  settings: SiteSettings;
  communityBusinessCount: number;
  communityAdCount: number;
  /** True once the first D1 API response has arrived. */
  ready: boolean;
  /** Set when directory data could not be loaded from Cloudflare D1. */
  error: string | null;
  refresh: () => Promise<void>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [communityBusinesses, setCommunityBusinesses] = useState<Business[]>([]);
  const [communityAds, setCommunityAds] = useState<MarketplaceItem[]>([]);
  const [overrides, setOverrides] = useState<ListingOverride[]>([]);
  const [settings, setSettings] = useState<SiteSettings>({ ...DEFAULT_SETTINGS });
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const loadBootstrap = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchDirectoryBootstrap(signal);
      if (signal?.aborted) return;
      setCommunityBusinesses(Array.isArray(data.businesses) ? data.businesses : []);
      setCommunityAds(Array.isArray(data.marketplaceItems) ? data.marketplaceItems : []);
      setOverrides(Array.isArray(data.overrides) ? data.overrides : []);
      setSettings(data.settings ? { ...DEFAULT_SETTINGS, ...data.settings } : { ...DEFAULT_SETTINGS });
      setError(null);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      logError('load bootstrap', err);
      setError('Directory listings could not be loaded right now.');
    } finally {
      if (!signal?.aborted) setReady(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadBootstrap(controller.signal);

    const onRefresh = () => {
      void loadBootstrap();
    };
    window.addEventListener(DATA_REFRESH_EVENT, onRefresh);

    return () => {
      controller.abort();
      window.removeEventListener(DATA_REFRESH_EVENT, onRefresh);
    };
  }, [loadBootstrap]);

  const businesses = useMemo(
    () => mergeCommunityAndSeedBusinesses(communityBusinesses, overrides, INITIAL_BUSINESSES),
    [communityBusinesses, overrides],
  );

  const marketplaceItems = useMemo(
    () => mergeCommunityAndSeedAds(communityAds, communityBusinesses, overrides, INITIAL_MARKETPLACE_ITEMS),
    [communityAds, communityBusinesses, overrides],
  );

  const refresh = useCallback(async () => {
    await loadBootstrap();
  }, [loadBootstrap]);

  const value = useMemo<DataContextType>(
    () => ({
      businesses,
      marketplaceItems,
      settings,
      communityBusinessCount: communityBusinesses.length,
      communityAdCount: communityAds.length,
      ready,
      error,
      refresh,
    }),
    [businesses, marketplaceItems, settings, communityBusinesses.length, communityAds.length, ready, error, refresh],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export const useData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within a DataProvider');
  return ctx;
};
