import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Filter, 
  MapPin, 
  Plus, 
  ShieldCheck, 
  Sparkles, 
  Tag, 
  ArrowUpDown, 
  RotateCcw,
  AlertTriangle,
  ChevronRight,
  TrendingUp,
  SlidersHorizontal,
  X
} from 'lucide-react';
import { MarketplaceItem, MarketplaceCategory, MarketplaceCondition, Business } from '../types';
import { MARKETPLACE_CATEGORIES, MARKETPLACE_SAFETY_TIPS } from '../data/marketplaceData';
import { STATES_DATA } from '../data/nigeriaData';
import { MarketplaceCard } from './MarketplaceCard';
import { pickDaily, useDayKey } from '../lib/daily';
import { FEATURED_AD_COUNT } from '../lib/config';

interface MarketplaceViewProps {
  items: MarketplaceItem[];
  businesses: Business[];
  onSelectItem: (item: MarketplaceItem) => void;
  onOpenPostAd: () => void;
  onOpenSellerBusiness?: (businessId: string) => void;
  initialCategory?: MarketplaceCategory | 'All';
  selectedStateFilter?: string;
}

export const MarketplaceView: React.FC<MarketplaceViewProps> = ({
  items,
  businesses,
  onSelectItem,
  onOpenPostAd,
  onOpenSellerBusiness,
  initialCategory = 'All',
  selectedStateFilter = '',
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<MarketplaceCategory | 'All'>(initialCategory);
  const [selectedState, setSelectedState] = useState(selectedStateFilter);
  const [selectedCondition, setSelectedCondition] = useState<string>('All');
  const [priceRange, setPriceRange] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'featured' | 'priceAsc' | 'priceDesc' | 'views'>('featured');
  const [showSafetyModal, setShowSafetyModal] = useState(false);

  // "TOP" ads rotate daily: a random selection of live ads, the same for every visitor until midnight (WAT).
  const today = useDayKey();
  const displayItems = useMemo(() => {
    const topIds = new Set(pickDaily(items, (i) => i.id, FEATURED_AD_COUNT, today, 'ads').map((i) => i.id));
    return items.map((i) => (topIds.has(i.id) === !!i.featured ? i : { ...i, featured: topIds.has(i.id) }));
  }, [items, today]);

  // Filtered Items logic
  const filteredItems = useMemo(() => {
    return displayItems.filter((item) => {
      // Category filter
      if (selectedCategory !== 'All' && item.category !== selectedCategory) {
        return false;
      }

      // State filter
      if (selectedState) {
        const sel = selectedState.toLowerCase();
        const itemSt = item.state.toLowerCase();
        const isFctMatch = (sel === 'fct' || sel === 'abuja') && (itemSt === 'fct' || itemSt === 'abuja');
        const isRiversMatch = (sel === 'rivers' || sel === 'port harcourt') && (itemSt === 'rivers' || itemSt === 'port harcourt');
        const isOyoMatch = (sel === 'oyo' || sel === 'ibadan') && (itemSt === 'oyo' || itemSt === 'ibadan');
        if (!isFctMatch && !isRiversMatch && !isOyoMatch && sel !== itemSt) {
          return false;
        }
      }

      // Condition filter
      if (selectedCondition !== 'All' && item.condition !== selectedCondition) {
        return false;
      }

      // Price range
      if (priceRange === 'under100k' && item.price >= 100000) return false;
      if (priceRange === '100k-500k' && (item.price < 100000 || item.price > 500000)) return false;
      if (priceRange === '500k-2m' && (item.price < 500000 || item.price > 2000000)) return false;
      if (priceRange === 'over2m' && item.price <= 2000000) return false;

      // Search term
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchDesc = item.description.toLowerCase().includes(q);
        const matchBiz = item.businessName.toLowerCase().includes(q);
        const matchLocation = item.state.toLowerCase().includes(q) || (item.locationHub && item.locationHub.toLowerCase().includes(q));
        const matchCat = item.category.toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchBiz && !matchLocation && !matchCat) {
          return false;
        }
      }

      return true;
    }).sort((a, b) => {
      if (sortBy === 'featured') {
        // Today's TOP picks first, then the newest member ads, then everything else by popularity.
        if (a.featured && !b.featured) return -1;
        if (!a.featured && b.featured) return 1;
        const byNewest = (b.createdAt ?? 0) - (a.createdAt ?? 0);
        if (byNewest !== 0) return byNewest;
        return b.viewsCount - a.viewsCount;
      }
      if (sortBy === 'priceAsc') return a.price - b.price;
      if (sortBy === 'priceDesc') return b.price - a.price;
      if (sortBy === 'views') return b.viewsCount - a.viewsCount;
      return 0;
    });
  }, [displayItems, selectedCategory, selectedState, selectedCondition, priceRange, searchTerm, sortBy]);

  const resetFilters = () => {
    setSearchTerm('');
    setSelectedCategory('All');
    setSelectedState('');
    setSelectedCondition('All');
    setPriceRange('all');
    setSortBy('featured');
  };

  const hasActiveFilters = searchTerm || selectedCategory !== 'All' || selectedState || selectedCondition !== 'All' || priceRange !== 'all';

  return (
    <div className="space-y-6">
      {/* Marketplace Hero & Ticker Banner */}
      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-emerald-800 via-emerald-700 to-teal-800 text-white p-5 sm:p-8 shadow-xl">
        <div className="relative z-10 max-w-3xl space-y-3">
          <div className="inline-flex items-center gap-2 bg-emerald-950/70 text-emerald-300 text-xs font-bold px-3 py-1 rounded-full border border-emerald-500/30">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            <span>Nigerian Marketplace</span>
            <span>•</span>
            <span>Member Merchants &amp; Direct Sellers</span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-black tracking-tight leading-tight">
            Buy & Sell Directly Across Nigeria
          </h1>

          <p className="text-emerald-100 text-xs sm:text-sm max-w-xl">
            Find Tokunbo cars, brand new gadgets, solar systems, agbada fashion, and real estate in Computer Village, Alaba, Banex, and nationwide.
          </p>

          {/* Quick CTA row */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={onOpenPostAd}
              className="flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-slate-900 font-black text-xs sm:text-sm px-5 py-2.5 rounded-xl shadow-lg transition-transform hover:scale-105 cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Post Free Ad / Sell Item</span>
            </button>

            <button
              onClick={() => setShowSafetyModal(true)}
              className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-3.5 py-2.5 rounded-xl border border-white/20 transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-300" />
              <span>Safety Guidelines</span>
            </button>
          </div>
        </div>

        {/* Decorative background watermark */}
        <div className="absolute right-4 bottom-[-10px] opacity-10 text-9xl font-black select-none pointer-events-none hidden md:block">
          ₦
        </div>
      </div>

      {/* Categories Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-xl p-3 sm:p-4 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {MARKETPLACE_CATEGORIES.map((cat) => {
            const isActive = selectedCategory === cat.key;
            return (
              <button
                key={cat.key}
                onClick={() => setSelectedCategory(cat.key)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <span>{cat.emoji}</span>
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search & Filter Controls */}
      <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search iPhone 15 Pro, Toyota Camry, Solar Inverter, Agbada, Rice bags..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:border-emerald-500 transition-colors"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filter Dropdowns Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
          {/* State Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Location / State
            </label>
            <select
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none font-medium cursor-pointer"
            >
              <option value="">All Nigeria (36 States + FCT)</option>
              {STATES_DATA.map((st) => (
                <option key={st.key} value={st.name}>{st.name}</option>
              ))}
            </select>
          </div>

          {/* Condition Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Condition
            </label>
            <select
              value={selectedCondition}
              onChange={(e) => setSelectedCondition(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none font-medium cursor-pointer"
            >
              <option value="All">All Conditions</option>
              <option value="Brand New">Brand New</option>
              <option value="Foreign Used (Tokunbo)">Foreign Used (Tokunbo)</option>
              <option value="Nigerian Used">Nigerian Used</option>
              <option value="Refurbished">Refurbished</option>
            </select>
          </div>

          {/* Price Range */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Price Range
            </label>
            <select
              value={priceRange}
              onChange={(e) => setPriceRange(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none font-medium cursor-pointer"
            >
              <option value="all">Any Price</option>
              <option value="under100k">Under ₦100,000</option>
              <option value="100k-500k">₦100,000 – ₦500,000</option>
              <option value="500k-2m">₦500,000 – ₦2,000,000</option>
              <option value="over2m">Above ₦2,000,000</option>
            </select>
          </div>

          {/* Sort */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Sort By
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none font-medium cursor-pointer"
            >
              <option value="featured">Featured / Recommended</option>
              <option value="priceAsc">Price: Low to High</option>
              <option value="priceDesc">Price: High to Low</option>
              <option value="views">Most Viewed</option>
            </select>
          </div>
        </div>

        {/* Active Filter Tags */}
        {hasActiveFilters && (
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-500 dark:text-slate-400 font-medium">Active filters:</span>
              {selectedCategory !== 'All' && (
                <span className="bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 px-2 py-0.5 rounded-md font-bold">
                  {selectedCategory}
                </span>
              )}
              {selectedState && (
                <span className="bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded-md font-bold">
                  {selectedState} State
                </span>
              )}
              {selectedCondition !== 'All' && (
                <span className="bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-200 px-2 py-0.5 rounded-md font-bold">
                  {selectedCondition}
                </span>
              )}
              {priceRange !== 'all' && (
                <span className="bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded-md font-bold">
                  Price Filtered
                </span>
              )}
            </div>

            <button
              onClick={resetFilters}
              className="text-xs text-rose-600 dark:text-rose-400 hover:underline font-bold flex items-center gap-1 cursor-pointer shrink-0"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset all</span>
            </button>
          </div>
        )}
      </div>

      {/* Results Count Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
            {selectedCategory === 'All' ? 'All Marketplace Listings' : selectedCategory}
          </h2>
          <span className="text-xs font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full">
            {filteredItems.length} ads
          </span>
        </div>

        <button
          onClick={onOpenPostAd}
          className="sm:hidden flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-800"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Sell</span>
        </button>
      </div>

      {/* Items Grid */}
      {filteredItems.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800 p-8 sm:p-12 text-center max-w-lg mx-auto space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950 text-amber-600 flex items-center justify-center mx-auto text-xl">
            🛍️
          </div>
          {items.length === 0 ? (
            <>
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-white">
                  No marketplace listings yet
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  All ads on NaijaPages Marketplace are posted by registered members. Be the first to post an item for sale.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  onClick={onOpenPostAd}
                  className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-4 py-2.5 rounded-lg shadow-sm cursor-pointer"
                >
                  Post Free Ad
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-white">
                  No marketplace items match your search
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Try clearing filters or be the first seller to list an item in this category or location.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  onClick={resetFilters}
                  className="text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 px-3.5 py-2 rounded-lg cursor-pointer"
                >
                  Reset Filters
                </button>
                <button
                  onClick={onOpenPostAd}
                  className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded-lg shadow-sm cursor-pointer"
                >
                  Post an Ad for This
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredItems.map((item) => (
            <MarketplaceCard
              key={item.id}
              item={item}
              onSelect={onSelectItem}
              onOpenSellerBusiness={onOpenSellerBusiness}
            />
          ))}
        </div>
      )}

      {/* Safety Modal Popup */}
      {showSafetyModal && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowSafetyModal(false)}
        >
          <div 
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 max-w-md w-full rounded-2xl p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-base text-slate-900 dark:text-white">
                  Safe Trading on NaijaPages Marketplace
                </h3>
              </div>
              <button
                onClick={() => setShowSafetyModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-700 dark:text-slate-300">
              {MARKETPLACE_SAFETY_TIPS.map((tip, idx) => (
                <div key={idx} className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 mb-1">
                    <span className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px]">
                      {idx + 1}
                    </span>
                    {tip.title}
                  </h4>
                  <p className="text-slate-600 dark:text-slate-400 pl-5">
                    {tip.desc}
                  </p>
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowSafetyModal(false)}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-xs cursor-pointer"
            >
              I Understand, Continue Browsing
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
