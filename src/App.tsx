/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Building2, 
  MapPin, 
  Search, 
  Filter, 
  Layers, 
  Sparkles, 
  Map, 
  LayoutGrid, 
  List, 
  CheckCircle2, 
  Star, 
  ArrowUpDown, 
  RotateCcw,
  Compass,
  Plus,
  ExternalLink,
  MessageCircle,
  Phone,
  ShoppingBag
} from 'lucide-react';
import { STATES_DATA, ZONES, CATEGORIES } from './data/nigeriaData';
import { Business, GeopoliticalZoneCode, MarketplaceItem } from './types';
import { useData } from './context/DataContext';
import { useAuth } from './context/AuthContext';
import { navigate, Route } from './lib/router';
import { submitAd, submitBusiness, AdInput, BusinessInput } from './services/content';
import { useLocalStorage } from './hooks/useLocalStorage';
import { Header } from './components/Header';
import { HeroSearch } from './components/HeroSearch';
import { GeopoliticalZoneFilter } from './components/GeopoliticalZoneFilter';
import { BusinessCard } from './components/BusinessCard';
import { SplitMapView } from './components/SplitMapView';
import { BusinessDetailsModal } from './components/BusinessDetailsModal';
import { AddBusinessModal } from './components/AddBusinessModal';
import { EmergencyModal } from './components/EmergencyModal';
import { StateExplorerModal } from './components/StateExplorerModal';
import { ShareBusinessModal } from './components/ShareBusinessModal';
import { ClaimListingModal } from './components/ClaimListingModal';
import { Pagination } from './components/Pagination';
import { AuthModal } from './components/AuthModal';
import { Newsletter } from './components/Newsletter';
import { FeaturedBusinessesCarousel } from './components/FeaturedBusinessesCarousel';
import { MarketplaceView } from './components/MarketplaceView';
import { ProductDetailsModal } from './components/ProductDetailsModal';
import { PostAdModal } from './components/PostAdModal';
import { ReportModal, ReportTarget } from './components/ReportModal';
import { MySubmissionsModal } from './components/MySubmissionsModal';
import { Footer } from './components/Footer';
import { AnnouncementBar } from './components/AnnouncementBar';
import { AccountBanner } from './components/AccountBanner';
import { AboutPage } from './pages/AboutPage';
import { ContactPage } from './pages/ContactPage';

export default function App({ route }: { route: Route }) {
  // Bookmarks and the theme stay on this device. Listings, ads and reviews live in the shared database.
  const [bookmarks, setBookmarks] = useLocalStorage<string[]>('naijapages_bookmarks_v1', []);
  const [isDarkMode, setIsDarkMode] = useLocalStorage<boolean>('naijapages_theme_dark', false);

  const { businesses: allBusinesses, marketplaceItems, settings, error: dataError } = useData();
  const { currentUser, userProfile, requireMember } = useAuth();

  // --- Routing: #/ (directory), #/marketplace, #/about, #/contact ---
  const activeMainTab: 'directory' | 'marketplace' = route.name === 'marketplace' ? 'marketplace' : 'directory';
  const setActiveMainTab = (tab: 'directory' | 'marketplace') => navigate(tab === 'marketplace' ? '/marketplace' : '/');
  const activePage = route.name === 'about' || route.name === 'contact' ? route.name : null;

  const [selectedMarketplaceItem, setSelectedMarketplaceItem] = useState<MarketplaceItem | null>(null);
  const [isPostAdModalOpen, setIsPostAdModalOpen] = useState(false);
  const [isMySubmissionsOpen, setIsMySubmissionsOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  // Businesses the signed-in member owns (an ad can only be linked to one of these).
  const ownBusinesses = useMemo(
    () => (currentUser ? allBusinesses.filter((b) => b.ownerId === currentUser.uid) : []),
    [allBusinesses, currentUser],
  );

  // --- Filtering & Search State ---
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedState, setSelectedState] = useState('');
  const [selectedLga, setSelectedLga] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [activeZone, setActiveZone] = useState<GeopoliticalZoneCode | 'ALL'>('ALL');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [whatsappOnly, setWhatsappOnly] = useState(false);
  const [highRatedOnly, setHighRatedOnly] = useState(false);
  const [showingBookmarksOnly, setShowingBookmarksOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'rating' | 'reviews' | 'name' | 'verified' | 'newest'>('rating');
  const [viewLayout, setViewLayout] = useState<'split' | 'grid'>('split');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  // --- Selection & Modal States ---
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(allBusinesses[0] || null);
  const [detailsModalBusiness, setDetailsModalBusiness] = useState<Business | null>(null);
  const [shareModalBusiness, setShareModalBusiness] = useState<Business | null>(null);
  const [claimModalBusiness, setClaimModalBusiness] = useState<Business | null>(null);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEmergencyModalOpen, setIsEmergencyModalOpen] = useState(false);
  const [isStateExplorerOpen, setIsStateExplorerOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Toggle Dark Mode Class on Root
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Each page gets its own tab title, and navigating between pages starts at the top.
  useEffect(() => {
    const titles: Record<Route['name'], string> = {
      home: 'NaijaPages | Nigeria Business Directory & Marketplace',
      marketplace: 'Marketplace | NaijaPages',
      about: 'About Us | NaijaPages',
      contact: 'Contact Us | NaijaPages',
      admin: 'Admin | NaijaPages',
    };
    document.title = titles[route.name];
    window.scrollTo({ top: 0 });
  }, [route.name]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4500);
  };

  // Member-only actions. requireMember opens the sign-in / verify-email / suspended prompt when needed.
  const openAddBusiness = () => {
    if (requireMember('list your business')) setIsAddModalOpen(true);
  };
  const openPostAd = () => {
    if (requireMember('post an ad')) setIsPostAdModalOpen(true);
  };
  const openReport = (target: ReportTarget) => {
    if (requireMember('report this')) setReportTarget(target);
  };

  // State zone mapping lookup
  const stateZoneMap = useMemo(() => {
    const map: Record<string, GeopoliticalZoneCode> = {};
    STATES_DATA.forEach((s) => {
      map[s.name.toLowerCase()] = s.zone;
    });
    return map;
  }, []);

  // Compute counts per geopolitical zone
  const zoneCounts = useMemo(() => {
    const counts: Record<GeopoliticalZoneCode, number> = {
      SW: 0,
      SS: 0,
      SE: 0,
      NC: 0,
      NW: 0,
      NE: 0,
    };
    allBusinesses.forEach((b) => {
      const z = stateZoneMap[b.state.toLowerCase()];
      if (z && z in counts) {
        counts[z] += 1;
      }
    });
    return counts;
  }, [allBusinesses, stateZoneMap]);

  // Compute counts per state
  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allBusinesses.forEach((b) => {
      counts[b.state] = (counts[b.state] || 0) + 1;
    });
    return counts;
  }, [allBusinesses]);

  // Main filtered businesses list
  const filteredBusinesses = useMemo(() => {
    return allBusinesses
      .filter((b) => {
        // Bookmarks only filter
        if (showingBookmarksOnly && !bookmarks.includes(b.id)) {
          return false;
        }

        // Search text query
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase();
          const matchName = b.name.toLowerCase().includes(q);
          const matchCat = b.category.toLowerCase().includes(q);
          const matchState = b.state.toLowerCase().includes(q) || 
            (b.state.toLowerCase() === 'fct' && 'abuja'.includes(q)) ||
            (b.state.toLowerCase() === 'rivers' && 'port harcourt'.includes(q)) ||
            (b.state.toLowerCase() === 'oyo' && 'ibadan'.includes(q)) ||
            (b.state.toLowerCase() === 'kano' && ('kano'.includes(q) || 'centre of commerce'.includes(q)));
          const matchLga = b.lga ? b.lga.toLowerCase().includes(q) : false;
          const matchAddr = b.address.toLowerCase().includes(q);
          const matchTags = b.tags ? b.tags.some((t) => t.toLowerCase().includes(q)) : false;
          const matchDesc = b.description ? b.description.toLowerCase().includes(q) : false;

          if (!matchName && !matchCat && !matchState && !matchLga && !matchAddr && !matchTags && !matchDesc) {
            return false;
          }
        }

        // State filter (supports 'Abuja'/'FCT', 'Rivers'/'Port Harcourt', 'Oyo'/'Ibadan' synonymously)
        if (selectedState) {
          const sel = selectedState.toLowerCase();
          const biz = b.state.toLowerCase();
          const isFctAbujaMatch = (sel === 'fct' || sel === 'abuja') && (biz === 'fct' || biz === 'abuja');
          const isRiversPhMatch = (sel === 'rivers' || sel === 'port harcourt') && (biz === 'rivers' || biz === 'port harcourt');
          const isOyoIbadanMatch = (sel === 'oyo' || sel === 'ibadan') && (biz === 'oyo' || biz === 'ibadan');
          if (!isFctAbujaMatch && !isRiversPhMatch && !isOyoIbadanMatch && sel !== biz) {
            return false;
          }
        }

        // LGA filter
        if (selectedLga && b.lga.toLowerCase() !== selectedLga.toLowerCase()) {
          return false;
        }

        // Geopolitical Zone filter
        if (activeZone !== 'ALL') {
          const bizZone = stateZoneMap[b.state.toLowerCase()];
          if (bizZone !== activeZone) {
            return false;
          }
        }

        // Category filter
        if (selectedCategory !== 'All' && b.category.toLowerCase() !== selectedCategory.toLowerCase()) {
          return false;
        }

        // Verified only
        if (verifiedOnly && !b.isVerified) {
          return false;
        }

        // WhatsApp direct only
        if (whatsappOnly && !b.whatsapp && !b.phone) {
          return false;
        }

        // High rated (4.5+)
        if (highRatedOnly && b.rating < 4.5) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        // New member listings have no rating yet, so they are ranked first ("New") rather than buried under 37,000 rated entries.
        if (sortBy === 'rating') {
          const rank = (x: Business) => (x.isUserAdded && !x.reviewsCount ? 5.1 : x.rating);
          return rank(b) - rank(a) || (b.createdAt ?? 0) - (a.createdAt ?? 0);
        }
        if (sortBy === 'newest') return (b.createdAt ?? 0) - (a.createdAt ?? 0);
        if (sortBy === 'reviews') return b.reviewsCount - a.reviewsCount;
        if (sortBy === 'verified') return (b.isVerified ? 1 : 0) - (a.isVerified ? 1 : 0);
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        return 0;
      });
  }, [
    allBusinesses,
    bookmarks,
    showingBookmarksOnly,
    searchTerm,
    selectedState,
    selectedLga,
    activeZone,
    selectedCategory,
    verifiedOnly,
    whatsappOnly,
    highRatedOnly,
    sortBy,
    stateZoneMap,
  ]);

  // Reset to page 1 on filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchTerm,
    selectedState,
    selectedLga,
    selectedCategory,
    activeZone,
    verifiedOnly,
    whatsappOnly,
    highRatedOnly,
    showingBookmarksOnly,
    sortBy,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredBusinesses.length / pageSize));

  // Slice for fast rendering & pagination
  const paginatedBusinesses = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredBusinesses.slice(start, start + pageSize);
  }, [filteredBusinesses, currentPage, pageSize]);

  // Keep selectedBusiness valid when listings change
  useEffect(() => {
    if (paginatedBusinesses.length > 0) {
      if (!selectedBusiness || !filteredBusinesses.some((b) => b.id === selectedBusiness.id)) {
        setSelectedBusiness(paginatedBusinesses[0]);
      }
    }
  }, [paginatedBusinesses, filteredBusinesses, selectedBusiness]);

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    if (filteredBusinesses.length > 0) {
      const nextStart = (newPage - 1) * pageSize;
      const nextFirst = filteredBusinesses[nextStart];
      if (nextFirst) {
        setSelectedBusiness(nextFirst);
      }
    }
    const anchor = document.getElementById('listings-anchor');
    if (anchor) {
      anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
    const anchor = document.getElementById('listings-anchor');
    if (anchor) {
      anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Handlers
  const handleToggleBookmark = (id: string) => {
    setBookmarks((prev) => {
      const exists = prev.includes(id);
      if (exists) {
        showToast('Business removed from saved list');
        return prev.filter((bId) => bId !== id);
      } else {
        showToast('Business added to saved list ⭐');
        return [...prev, id];
      }
    });
  };

  // Saved to the shared database as "pending"; an admin approves it before it appears publicly.
  const handleAddBusiness = async (input: BusinessInput) => {
    if (!currentUser) throw new Error('Please sign in first.');
    await submitBusiness(currentUser, userProfile?.displayName, input);
    showToast(`"${input.name}" was submitted for review. Track it under My Submissions. 🎉`);
  };

  const handleResetFilters = () => {
    setSearchTerm('');
    setSelectedState('');
    setSelectedLga('');
    setSelectedCategory('All');
    setActiveZone('ALL');
    setVerifiedOnly(false);
    setWhatsappOnly(false);
    setHighRatedOnly(false);
    setShowingBookmarksOnly(false);
    showToast('All search filters reset');
  };

  const handlePostAd = async (input: AdInput) => {
    if (!currentUser) throw new Error('Please sign in first.');
    const { status } = await submitAd(currentUser, userProfile?.displayName, input, settings.adsNeedApproval);
    if (status === 'active') {
      showToast('Your ad is live on the Marketplace! 🎉');
      navigate('/marketplace');
    } else {
      showToast('Your ad was submitted and will appear once our team approves it.');
    }
  };

  const handleOpenSellerBusiness = (businessId: string) => {
    const biz = allBusinesses.find((b) => b.id === businessId);
    if (biz) {
      setDetailsModalBusiness(biz);
    } else {
      showToast('Business details not found in directory');
    }
  };

  // Popular Nigerian Hub quick links
  const popularHubs = [
    { label: 'Kogi (Confluence)', state: 'Kogi' },
    { label: 'Lagos Hub', state: 'Lagos' },
    { label: 'Abuja FCT', state: 'FCT' },
    { label: 'Port Harcourt', state: 'Rivers' },
    { label: 'Ibadan City', state: 'Oyo' },
    { label: 'Kano Commercial', state: 'Kano' },
    { label: 'Enugu Coal City', state: 'Enugu' },
    { label: 'Onitsha/Nnewi', state: 'Anambra' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors selection:bg-emerald-500 selection:text-white">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-4 py-2.5 rounded-xl shadow-xl border border-slate-700 dark:border-slate-300 text-xs font-bold flex items-center gap-2 animate-bounce">
          <Sparkles className="w-4 h-4 text-emerald-400 dark:text-emerald-600" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Header */}
      <Header
        activeMainTab={activePage ? null : activeMainTab}
        activePage={activePage}
        onChangeMainTab={setActiveMainTab}
        onAddBusiness={openAddBusiness}
        onOpenPostAd={openPostAd}
        onOpenMySubmissions={() => setIsMySubmissionsOpen(true)}
        onOpenEmergency={() => setIsEmergencyModalOpen(true)}
        onOpenStateExplorer={() => setIsStateExplorerOpen(true)}
        onToggleBookmarksOnly={() => {
          setActiveMainTab('directory');
          setShowingBookmarksOnly((prev) => !prev);
        }}
        showingBookmarksOnly={showingBookmarksOnly}
        bookmarkedCount={bookmarks.length}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode((prev) => !prev)}
        totalListings={allBusinesses.length}
        marketplaceItemsCount={marketplaceItems.length}
      />

      <AnnouncementBar enabled={settings.announcementEnabled} text={settings.announcementText} />
      <AccountBanner />
      {dataError && (
        <div role="status" className="bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 text-[11px] px-4 py-1.5 text-center border-b border-slate-200 dark:border-slate-800">
          Community listings are taking a moment to load. Showing the built-in directory for now.
        </div>
      )}

      {/* Page content: About / Contact / Marketplace / Directory */}
      {route.name === 'about' ? (
        <AboutPage
          settings={settings}
          stats={{
            listings: allBusinesses.length,
            ads: marketplaceItems.length,
            states: STATES_DATA.length,
            categories: CATEGORIES.filter((c) => c.key !== 'All').length,
          }}
          onAddBusiness={openAddBusiness}
        />
      ) : route.name === 'contact' ? (
        <ContactPage settings={settings} />
      ) : activeMainTab === 'marketplace' ? (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full flex-1">
          <MarketplaceView
            items={marketplaceItems}
            businesses={allBusinesses}
            onSelectItem={(item) => setSelectedMarketplaceItem(item)}
            onOpenPostAd={openPostAd}
            onOpenSellerBusiness={handleOpenSellerBusiness}
            selectedStateFilter={selectedState}
          />
        </main>
      ) : (
        <>
          {/* Hero Section & Search Engine */}
          <HeroSearch
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            selectedState={selectedState}
            onStateChange={setSelectedState}
            selectedLga={selectedLga}
            onLgaChange={setSelectedLga}
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
            verifiedOnly={verifiedOnly}
            onToggleVerifiedOnly={() => setVerifiedOnly((prev) => !prev)}
            whatsappOnly={whatsappOnly}
            onToggleWhatsappOnly={() => setWhatsappOnly((prev) => !prev)}
            highRatedOnly={highRatedOnly}
            onToggleHighRatedOnly={() => setHighRatedOnly((prev) => !prev)}
            onResetFilters={handleResetFilters}
            totalFiltered={filteredBusinesses.length}
            totalAll={allBusinesses.length}
          />

          {/* Geopolitical Zones Regional Navigator */}
          <GeopoliticalZoneFilter
            activeZone={activeZone}
            onSelectZone={setActiveZone}
            zoneCounts={zoneCounts}
          />

          {/* Popular Commercial Hubs Quick Chips */}
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 w-full flex items-center gap-2 overflow-x-auto text-xs scrollbar-none">
            <span className="font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider shrink-0 text-[11px]">
              Hot Hubs:
            </span>
            {popularHubs.map((hub) => (
              <button
                key={hub.state}
                onClick={() => {
                  setSelectedState(hub.state);
                  setSelectedLga('');
                }}
                className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors border ${
                  selectedState.toLowerCase() === hub.state.toLowerCase()
                    ? 'bg-emerald-700 text-white border-emerald-700 font-bold'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-500'
                }`}
              >
                {hub.label}
              </button>
            ))}
          </div>

          {/* Main Content Area */}
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 w-full flex-1">
            {/* Featured Businesses Carousel */}
            {!showingBookmarksOnly && (
              <FeaturedBusinessesCarousel
                businesses={allBusinesses}
                selectedState={selectedState}
                onSelectBusiness={(biz) => setSelectedBusiness(biz)}
            onViewDetails={(biz) => setDetailsModalBusiness(biz)}
            onToggleBookmark={(id) => handleToggleBookmark(id)}
            bookmarks={bookmarks}
            onShare={(biz) => setShareModalBusiness(biz)}
          />
        )}

        {/* Sorting & Layout View Toggle Bar */}
        <div id="listings-anchor" className="scroll-mt-20 flex flex-wrap items-center justify-between gap-3 mb-5 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">
              {showingBookmarksOnly ? 'Saved Bookmarks' : (selectedState ? `${selectedState} State Businesses` : 'Verified Directory Listings')}
            </h2>
            <span className="text-xs font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full">
              {filteredBusinesses.length}
            </span>
            {filteredBusinesses.length > pageSize && (
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium hidden sm:inline">
                • Page {currentPage} of {totalPages}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {/* Sort Dropdown */}
            <div className="flex items-center gap-1.5 text-xs font-semibold bg-white dark:bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800">
              <ArrowUpDown className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-slate-500 hidden sm:inline">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-transparent text-slate-800 dark:text-slate-100 outline-none cursor-pointer font-bold"
              >
                <option value="rating">Highest Rated</option>
                <option value="newest">Newest First</option>
                <option value="reviews">Most Reviewed</option>
                <option value="verified">Verified First</option>
                <option value="name">Alphabetical (A-Z)</option>
              </select>
            </div>

            {/* Layout switch: Split Map vs Grid */}
            <div className="flex items-center bg-white dark:bg-slate-900 p-1 rounded-lg border border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setViewLayout('split')}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  viewLayout === 'split'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
                title="Split Map View (Interactive Directions)"
              >
                <Map className="w-4 h-4" />
              </button>

              <button
                onClick={() => setViewLayout('grid')}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  viewLayout === 'grid'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
                title="Cards Grid View"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Content Section: Either Split Map or Full Grid */}
        {filteredBusinesses.length === 0 ? (
          /* Empty State */
          <div className="bg-white dark:bg-slate-900 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800 p-8 sm:p-12 text-center max-w-xl mx-auto my-8 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center mx-auto">
              <Building2 className="w-7 h-7" />
            </div>

            <div>
              <h3 className="font-black text-lg text-slate-900 dark:text-white">
                No Nigerian businesses match your search
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                We couldn't find any listings matching "{searchTerm || selectedCategory}". Try selecting another state, removing active filters, or list your business now.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                onClick={handleResetFilters}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl flex items-center gap-1.5 transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset All Filters</span>
              </button>

              <button
                onClick={openAddBusiness}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>List this Business in Nigeria</span>
              </button>
            </div>
          </div>
        ) : viewLayout === 'split' ? (
          /* Responsive Split View: Left List, Right Sticky Map */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Business Listings Column */}
            <div className="lg:col-span-7 space-y-3.5">
              {paginatedBusinesses.map((business, index) => (
                <BusinessCard
                  key={business.id}
                  business={business}
                  index={(currentPage - 1) * pageSize + index}
                  isSelected={selectedBusiness?.id === business.id}
                  isBookmarked={bookmarks.includes(business.id)}
                  onSelect={() => setSelectedBusiness(business)}
                  onViewDetails={() => setDetailsModalBusiness(business)}
                  onToggleBookmark={() => handleToggleBookmark(business.id)}
                  onShare={() => setShareModalBusiness(business)}
                />
              ))}

              {/* Pagination Controls */}
              <Pagination
                currentPage={currentPage}
                totalItems={filteredBusinesses.length}
                pageSize={pageSize}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
              />
            </div>

            {/* Sticky Interactive Map Column */}
            <div className="lg:col-span-5 hidden lg:block">
              <SplitMapView
                selectedBusiness={selectedBusiness}
                activeState={selectedState}
                onViewDetails={(biz) => setDetailsModalBusiness(biz)}
              />
            </div>
          </div>
        ) : (
          /* Cards Grid View */
          <div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginatedBusinesses.map((business, index) => (
                <BusinessCard
                  key={business.id}
                  business={business}
                  index={(currentPage - 1) * pageSize + index}
                  isSelected={selectedBusiness?.id === business.id}
                  isBookmarked={bookmarks.includes(business.id)}
                  onSelect={() => setSelectedBusiness(business)}
                  onViewDetails={() => setDetailsModalBusiness(business)}
                  onToggleBookmark={() => handleToggleBookmark(business.id)}
                  onShare={() => setShareModalBusiness(business)}
                />
              ))}
            </div>

            {/* Pagination Controls */}
            <Pagination
              currentPage={currentPage}
              totalItems={filteredBusinesses.length}
              pageSize={pageSize}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          </div>
        )}

        {/* Newsletter Subscription */}
        <Newsletter />
      </main>
      </>
      )}

      <Footer
        settings={settings}
        onOpenStateExplorer={() => {
          setActiveMainTab('directory');
          setIsStateExplorerOpen(true);
        }}
        onOpenEmergency={() => setIsEmergencyModalOpen(true)}
        onAddBusiness={openAddBusiness}
        onPostAd={openPostAd}
      />

      {/* --- Modals --- */}
      <BusinessDetailsModal
        business={detailsModalBusiness}
        isOpen={Boolean(detailsModalBusiness)}
        onClose={() => setDetailsModalBusiness(null)}
        isBookmarked={Boolean(detailsModalBusiness && bookmarks.includes(detailsModalBusiness.id))}
        onToggleBookmark={() => detailsModalBusiness && handleToggleBookmark(detailsModalBusiness.id)}
        onShare={() => {
          setShareModalBusiness(detailsModalBusiness);
        }}
        onClaim={() => {
          if (requireMember('claim a listing')) setClaimModalBusiness(detailsModalBusiness);
        }}
        onReport={openReport}
        marketplaceItems={marketplaceItems}
        onSelectProduct={(item) => setSelectedMarketplaceItem(item)}
        onPostProductForBusiness={openPostAd}
      />

      <ProductDetailsModal
        item={selectedMarketplaceItem}
        isOpen={Boolean(selectedMarketplaceItem)}
        onClose={() => setSelectedMarketplaceItem(null)}
        onOpenSellerBusiness={handleOpenSellerBusiness}
        onShare={(it) => {
          showToast(`Link copied for "${it.title}"`);
        }}
        onReport={openReport}
      />

      <PostAdModal
        isOpen={isPostAdModalOpen}
        onClose={() => setIsPostAdModalOpen(false)}
        onPostAd={handlePostAd}
        businesses={ownBusinesses}
      />

      <AddBusinessModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddBusiness={handleAddBusiness}
      />

      <EmergencyModal
        isOpen={isEmergencyModalOpen}
        onClose={() => setIsEmergencyModalOpen(false)}
      />

      <StateExplorerModal
        isOpen={isStateExplorerOpen}
        onClose={() => setIsStateExplorerOpen(false)}
        onSelectState={(st) => {
          setActiveMainTab('directory');
          setSelectedState(st);
          setSelectedLga('');
          showToast(`Filtered by ${st} State`);
        }}
        stateCounts={stateCounts}
      />

      <ShareBusinessModal
        business={shareModalBusiness}
        isOpen={Boolean(shareModalBusiness)}
        onClose={() => setShareModalBusiness(null)}
      />

      <ClaimListingModal
        business={claimModalBusiness}
        isOpen={Boolean(claimModalBusiness)}
        onClose={() => setClaimModalBusiness(null)}
        onSubmitted={(b) => showToast(`Your claim for "${b.name}" was submitted for review.`)}
      />

      <ReportModal target={reportTarget} onClose={() => setReportTarget(null)} />

      <MySubmissionsModal
        isOpen={isMySubmissionsOpen}
        onClose={() => setIsMySubmissionsOpen(false)}
        onListBusiness={openAddBusiness}
        onPostAd={openPostAd}
      />

      <AuthModal />
    </div>
  );
}
