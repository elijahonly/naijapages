import test from 'node:test';
import assert from 'node:assert/strict';
import type { Business, GeopoliticalZoneCode, ListingOverride, MarketplaceItem } from '../types';
import {
  computeStateCounts,
  computeZoneCounts,
  filterAndSortBusinesses,
  mergeCommunityAndSeedAds,
  mergeCommunityAndSeedBusinesses,
  type BusinessFilterState,
} from './directory';

const SAMPLE_ZONE_MAP: Record<string, GeopoliticalZoneCode> = {
  lagos: 'SW',
  fct: 'NC',
  rivers: 'SS',
  kano: 'NW',
};

const SEED_BIZ: Business[] = [
  {
    id: 'seed-1',
    name: 'Victoria Island Coffee Co',
    category: 'Food',
    state: 'Lagos',
    lga: 'Eti-Osa',
    address: '12 Adeola Odeku',
    phone: '08011112222',
    whatsapp: '08011112222',
    rating: 4.7,
    reviewsCount: 15,
    isVerified: false,
  },
  {
    id: 'seed-2',
    name: 'Hidden Seed Clinic',
    category: 'Health',
    state: 'Rivers',
    lga: 'Port Harcourt',
    address: '5 Aba Road',
    phone: '08033334444',
    rating: 4.1,
    reviewsCount: 3,
    isVerified: false,
  },
];

const COMMUNITY_BIZ: Business[] = [
  {
    id: 'comm-1',
    name: 'Abuja Tech Hub',
    category: 'Tech',
    state: 'FCT',
    lga: 'Abuja Municipal',
    address: '42 Aminu Kano Crescent',
    phone: '08055556666',
    rating: 0,
    reviewsCount: 0,
    isVerified: true,
    isUserAdded: true,
    createdAt: 2000,
    tags: ['coworking', 'fiber'],
  },
];

const DEFAULT_FILTERS: BusinessFilterState = {
  searchTerm: '',
  selectedState: '',
  selectedLga: '',
  selectedCategory: 'All',
  activeZone: 'ALL',
  verifiedOnly: false,
  whatsappOnly: false,
  highRatedOnly: false,
  showingBookmarksOnly: false,
  bookmarks: [],
  sortBy: 'rating',
};

test('mergeCommunityAndSeedBusinesses hides suppressed seeds and applies verified/claimed overrides', () => {
  const overrides: ListingOverride[] = [
    { id: 'seed-1', kind: 'business', hidden: false, verified: true, claimedBy: 'u1' },
    { id: 'seed-2', kind: 'business', hidden: true, verified: false },
  ];

  const merged = mergeCommunityAndSeedBusinesses(COMMUNITY_BIZ, overrides, SEED_BIZ);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'comm-1');
  assert.equal(merged[1].id, 'seed-1');
  assert.equal(merged[1].isVerified, true);
  assert.equal(merged[1].claimed, true);
});

test('mergeCommunityAndSeedAds propagates linked business verification', () => {
  const ads: MarketplaceItem[] = [
    {
      id: 'ad-1',
      businessId: 'comm-1',
      businessName: 'Abuja Tech Hub',
      title: 'ThinkPad X1 Carbon',
      category: 'Electronics & Appliances',
      price: 450000,
      isNegotiable: true,
      condition: 'Foreign Used (Tokunbo)',
      description: 'Mint condition',
      imageUrl: '/api/media/public/a.png',
      state: 'FCT',
      lga: 'Abuja Municipal',
      phone: '08055556666',
      postedDate: 'Just now',
      viewsCount: 10,
      isVerifiedSeller: false,
    },
  ];
  const merged = mergeCommunityAndSeedAds(ads, COMMUNITY_BIZ, [], []);
  assert.equal(merged[0].isVerifiedSeller, true);
});

test('filterAndSortBusinesses handles Abuja/FCT synonym, zones, bookmarks, and ranks new member listings first', () => {
  const combined = [...SEED_BIZ, ...COMMUNITY_BIZ];

  const allSorted = filterAndSortBusinesses(combined, DEFAULT_FILTERS, SAMPLE_ZONE_MAP);
  assert.equal(allSorted[0].id, 'comm-1');
  assert.equal(allSorted[1].id, 'seed-1');

  const abujaFiltered = filterAndSortBusinesses(
    combined,
    { ...DEFAULT_FILTERS, selectedState: 'Abuja', activeZone: 'NC', searchTerm: 'coworking' },
    SAMPLE_ZONE_MAP,
  );
  assert.deepEqual(
    abujaFiltered.map((b) => b.id),
    ['comm-1'],
  );

  const bookmarked = filterAndSortBusinesses(
    combined,
    { ...DEFAULT_FILTERS, showingBookmarksOnly: true, bookmarks: ['seed-2'] },
    SAMPLE_ZONE_MAP,
  );
  assert.deepEqual(
    bookmarked.map((b) => b.id),
    ['seed-2'],
  );
});

test('computeZoneCounts and computeStateCounts summarize listings accurately', () => {
  const combined = [...SEED_BIZ, ...COMMUNITY_BIZ];
  const zones = computeZoneCounts(combined, SAMPLE_ZONE_MAP);
  const states = computeStateCounts(combined);

  assert.equal(zones.SW, 1);
  assert.equal(zones.SS, 1);
  assert.equal(zones.NC, 1);
  assert.equal(zones.NW, 0);
  assert.equal(states.Lagos, 1);
  assert.equal(states.FCT, 1);
});
