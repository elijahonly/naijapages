/**
 * Directory & marketplace read/search services backed by Cloudflare D1 (`/api/v1/*`),
 * plus pure, unit-testable merge, filter, count, and sorting helpers.
 */

import { apiFetch } from '../lib/apiClient';
import type {
  Business,
  GeopoliticalZoneCode,
  ListingOverride,
  MarketplaceItem,
  SiteSettings,
} from '../types';

export interface BootstrapPayload {
  businesses: Business[];
  marketplaceItems: MarketplaceItem[];
  overrides: ListingOverride[];
  settings: SiteSettings;
}

export interface DirectoryCategoryItem {
  id: string;
  kind: 'directory' | 'marketplace';
  key: string;
  label: string;
  emoji: string;
  sortOrder: number;
}

export interface DirectorySearchParams {
  q?: string;
  category?: string;
  state?: string;
  lga?: string;
  zone?: string;
  verifiedOnly?: boolean;
  whatsappOnly?: boolean;
  minRating?: number;
  sort?: 'rating' | 'newest' | 'reviews' | 'verified' | 'name';
  page?: number;
  pageSize?: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface BusinessFilterState {
  searchTerm: string;
  selectedState: string;
  selectedLga: string;
  selectedCategory: string;
  activeZone: GeopoliticalZoneCode | 'ALL';
  verifiedOnly: boolean;
  whatsappOnly: boolean;
  highRatedOnly: boolean;
  showingBookmarksOnly: boolean;
  bookmarks: string[];
  sortBy: 'rating' | 'reviews' | 'name' | 'verified' | 'newest';
}

// ---------------------------------------------------------------------------
// API Service Methods
// ---------------------------------------------------------------------------

export async function fetchDirectoryBootstrap(signal?: AbortSignal): Promise<BootstrapPayload> {
  return apiFetch<BootstrapPayload>('/api/v1/directory/bootstrap', { signal });
}

export async function fetchDirectoryCategories(
  kind?: 'directory' | 'marketplace',
  signal?: AbortSignal,
): Promise<DirectoryCategoryItem[]> {
  const qs = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  const res = await apiFetch<{ items: DirectoryCategoryItem[] }>(
    `/api/v1/directory/categories${qs}`,
    { signal },
  );
  return res.items;
}

export async function searchDirectoryBusinesses(
  params: DirectorySearchParams,
  signal?: AbortSignal,
): Promise<{ items: Business[]; pagination: PaginationMeta }> {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.category && params.category !== 'All') sp.set('category', params.category);
  if (params.state) sp.set('state', params.state);
  if (params.lga) sp.set('lga', params.lga);
  if (params.zone && params.zone !== 'ALL') sp.set('zone', params.zone);
  if (params.verifiedOnly) sp.set('verifiedOnly', 'true');
  if (params.whatsappOnly) sp.set('whatsappOnly', 'true');
  if (typeof params.minRating === 'number' && params.minRating > 0) {
    sp.set('minRating', String(params.minRating));
  }
  if (params.sort) sp.set('sort', params.sort);
  if (params.page) sp.set('page', String(params.page));
  if (params.pageSize) sp.set('pageSize', String(params.pageSize));
  const qs = sp.toString();
  return apiFetch<{ items: Business[]; pagination: PaginationMeta }>(
    `/api/v1/directory/businesses${qs ? `?${qs}` : ''}`,
    { signal },
  );
}

export async function fetchDirectoryBusinessById(
  id: string,
  signal?: AbortSignal,
): Promise<Business | null> {
  const res = await apiFetch<{ item: Business }>(
    `/api/v1/directory/businesses/${encodeURIComponent(id)}`,
    { signal },
  );
  return res.item ?? null;
}

export async function searchMarketplaceItems(
  params: {
    q?: string;
    category?: string;
    state?: string;
    condition?: string;
    minPrice?: number;
    maxPrice?: number;
    sort?: 'featured' | 'newest' | 'priceAsc' | 'priceDesc' | 'views';
    page?: number;
    pageSize?: number;
  },
  signal?: AbortSignal,
): Promise<{ items: MarketplaceItem[]; pagination: PaginationMeta }> {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.category && params.category !== 'All') sp.set('category', params.category);
  if (params.state) sp.set('state', params.state);
  if (params.condition && params.condition !== 'All') sp.set('condition', params.condition);
  if (typeof params.minPrice === 'number') sp.set('minPrice', String(params.minPrice));
  if (typeof params.maxPrice === 'number') sp.set('maxPrice', String(params.maxPrice));
  if (params.sort) sp.set('sort', params.sort);
  if (params.page) sp.set('page', String(params.page));
  if (params.pageSize) sp.set('pageSize', String(params.pageSize));
  const qs = sp.toString();
  return apiFetch<{ items: MarketplaceItem[]; pagination: PaginationMeta }>(
    `/api/v1/marketplace/ads${qs ? `?${qs}` : ''}`,
    { signal },
  );
}

// ---------------------------------------------------------------------------
// Pure Merging, Counting, Filtering & Sorting Helpers
// ---------------------------------------------------------------------------

export function mergeCommunityAndSeedBusinesses(
  communityBusinesses: Business[],
  overrides: ListingOverride[],
  seedBusinesses: Business[],
): Business[] {
  const hidden = new Set<string>();
  const flagged = new Map<string, ListingOverride>();

  for (const o of overrides) {
    if (o.kind !== 'business') continue;
    if (o.hidden) hidden.add(o.id);
    else if (o.verified || o.claimedBy) flagged.set(o.id, o);
  }

  const communityIds = new Set(communityBusinesses.map((b) => b.id));
  const seeds = seedBusinesses
    .filter((b) => !hidden.has(b.id) && !communityIds.has(b.id))
    .map((b) => {
      const f = flagged.get(b.id);
      return f ? { ...b, isVerified: b.isVerified || !!f.verified, claimed: !!f.claimedBy } : b;
    });

  return [...communityBusinesses, ...seeds];
}

export function mergeCommunityAndSeedAds(
  communityAds: MarketplaceItem[],
  communityBusinesses: Business[],
  overrides: ListingOverride[],
  seedAds: MarketplaceItem[],
): MarketplaceItem[] {
  const hidden = new Set(
    overrides.filter((o) => o.kind === 'marketplace' && o.hidden).map((o) => o.id),
  );
  const ownBusinessById = new Map(communityBusinesses.map((b) => [b.id, b]));
  const communityIds = new Set(communityAds.map((a) => a.id));

  const ads = communityAds.map((ad) => ({
    ...ad,
    isVerifiedSeller:
      ad.isVerifiedSeller ||
      (ad.businessId ? ownBusinessById.get(ad.businessId)?.isVerified === true : false),
  }));

  const seeds = seedAds.filter((i) => !hidden.has(i.id) && !communityIds.has(i.id));
  return [...ads, ...seeds];
}

export function matchesStateAlias(selectedState: string, businessState: string): boolean {
  const sel = selectedState.trim().toLowerCase();
  const biz = businessState.trim().toLowerCase();
  if (!sel) return true;
  if ((sel === 'fct' || sel === 'abuja') && (biz === 'fct' || biz === 'abuja')) return true;
  if ((sel === 'rivers' || sel === 'port harcourt') && (biz === 'rivers' || biz === 'port harcourt')) return true;
  if ((sel === 'oyo' || sel === 'ibadan') && (biz === 'oyo' || biz === 'ibadan')) return true;
  return sel === biz;
}

export function filterAndSortBusinesses(
  businesses: Business[],
  filters: BusinessFilterState,
  stateZoneMap: Record<string, GeopoliticalZoneCode>,
): Business[] {
  const bookmarkSet = filters.showingBookmarksOnly ? new Set(filters.bookmarks) : null;
  const q = filters.searchTerm.trim().toLowerCase();

  return businesses
    .filter((b) => {
      if (bookmarkSet && !bookmarkSet.has(b.id)) return false;

      if (q) {
        const matchName = b.name.toLowerCase().includes(q);
        const matchCat = b.category.toLowerCase().includes(q);
        const stLower = b.state.toLowerCase();
        const matchState =
          stLower.includes(q) ||
          (stLower === 'fct' && 'abuja'.includes(q)) ||
          (stLower === 'rivers' && 'port harcourt'.includes(q)) ||
          (stLower === 'oyo' && 'ibadan'.includes(q)) ||
          (stLower === 'kano' && ('kano'.includes(q) || 'centre of commerce'.includes(q)));
        const matchLga = b.lga ? b.lga.toLowerCase().includes(q) : false;
        const matchAddr = b.address.toLowerCase().includes(q);
        const matchTags = b.tags ? b.tags.some((t) => t.toLowerCase().includes(q)) : false;
        const matchDesc = b.description ? b.description.toLowerCase().includes(q) : false;

        if (!matchName && !matchCat && !matchState && !matchLga && !matchAddr && !matchTags && !matchDesc) {
          return false;
        }
      }

      if (filters.selectedState && !matchesStateAlias(filters.selectedState, b.state)) {
        return false;
      }

      if (filters.selectedLga && b.lga.toLowerCase() !== filters.selectedLga.toLowerCase()) {
        return false;
      }

      if (filters.activeZone !== 'ALL') {
        const bizZone = stateZoneMap[b.state.toLowerCase()];
        if (bizZone !== filters.activeZone) return false;
      }

      if (
        filters.selectedCategory !== 'All' &&
        b.category.toLowerCase() !== filters.selectedCategory.toLowerCase()
      ) {
        return false;
      }

      if (filters.verifiedOnly && !b.isVerified) return false;
      if (filters.whatsappOnly && !b.whatsapp && !b.phone) return false;
      if (filters.highRatedOnly && b.rating < 4.5) return false;

      return true;
    })
    .sort((a, b) => {
      if (filters.sortBy === 'rating') {
        const rank = (x: Business) => (x.isUserAdded && !x.reviewsCount ? 5.1 : x.rating);
        return rank(b) - rank(a) || (b.createdAt ?? 0) - (a.createdAt ?? 0);
      }
      if (filters.sortBy === 'newest') return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      if (filters.sortBy === 'reviews') return b.reviewsCount - a.reviewsCount;
      if (filters.sortBy === 'verified') return (b.isVerified ? 1 : 0) - (a.isVerified ? 1 : 0);
      if (filters.sortBy === 'name') return a.name.localeCompare(b.name);
      return 0;
    });
}

export function computeZoneCounts(
  businesses: Business[],
  stateZoneMap: Record<string, GeopoliticalZoneCode>,
): Record<GeopoliticalZoneCode, number> {
  const counts: Record<GeopoliticalZoneCode, number> = {
    SW: 0,
    SS: 0,
    SE: 0,
    NC: 0,
    NW: 0,
    NE: 0,
  };
  for (const b of businesses) {
    const z = stateZoneMap[b.state.toLowerCase()];
    if (z && z in counts) counts[z] += 1;
  }
  return counts;
}

export function computeStateCounts(businesses: Business[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const b of businesses) {
    counts[b.state] = (counts[b.state] || 0) + 1;
  }
  return counts;
}
