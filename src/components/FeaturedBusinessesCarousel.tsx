import React, { useRef, useState, useEffect } from 'react';
import { 
  Award, 
  Star, 
  CheckCircle, 
  MapPin, 
  Phone, 
  MessageCircle, 
  Navigation, 
  Eye, 
  Bookmark, 
  Share2, 
  ChevronLeft, 
  ChevronRight, 
  Sparkles, 
  Building2,
  Pause,
  Play,
  ShieldCheck,
  TrendingUp
} from 'lucide-react';
import { Business } from '../types';
import { formatWhatsAppUrl, formatTelUrl } from '../data/nigeriaData';
import { pickDaily, useDayKey } from '../lib/daily';
import { FEATURED_BUSINESS_COUNT } from '../lib/config';
import { ratingSummary } from '../lib/format';

interface FeaturedBusinessesCarouselProps {
  businesses: Business[];
  selectedState?: string;
  onSelectBusiness: (business: Business) => void;
  onViewDetails: (business: Business) => void;
  onToggleBookmark: (businessId: string) => void;
  bookmarks: string[];
  onShare: (business: Business) => void;
}

export const FeaturedBusinessesCarousel: React.FC<FeaturedBusinessesCarouselProps> = ({
  businesses,
  selectedState,
  onSelectBusiness,
  onViewDetails,
  onToggleBookmark,
  bookmarks,
  onShare,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [viewScope, setViewScope] = useState<'local' | 'nationwide'>('local');

  // ---- Daily random spotlight ------------------------------------------------
  // Every visitor sees the same picks on a given day (Nigerian time); they change at midnight.
  const today = useDayKey();

  // Eligible: verified listings approved and verified by an administrator.
  const pool = React.useMemo(
    () => businesses.filter((b) => b.isVerified),
    [businesses],
  );

  const activeState = selectedState && selectedState.toLowerCase() !== 'all' ? selectedState : '';
  const statePool = React.useMemo(
    () => (activeState ? pool.filter((b) => b.state.toLowerCase() === activeState.toLowerCase()) : []),
    [pool, activeState],
  );
  const hasLocalMatches = statePool.length >= 2;

  const qualifiedBusinesses = React.useMemo(() => {
    if (activeState && viewScope === 'local' && hasLocalMatches) {
      return pickDaily(statePool, (b) => b.id, FEATURED_BUSINESS_COUNT, today, `biz:${activeState.toLowerCase()}`);
    }
    return pickDaily(pool, (b) => b.id, FEATURED_BUSINESS_COUNT, today, 'biz:nationwide');
  }, [pool, statePool, activeState, viewScope, hasLocalMatches, today]);

  const todayLabel = React.useMemo(
    () =>
      new Intl.DateTimeFormat('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
        new Date(`${today}T12:00:00Z`),
      ),
    [today],
  );

  // Check scroll positions
  const updateScrollButtons = () => {
    if (!scrollContainerRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
  };

  useEffect(() => {
    updateScrollButtons();
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    window.addEventListener('resize', updateScrollButtons);
    return () => {
      el.removeEventListener('scroll', updateScrollButtons);
      window.removeEventListener('resize', updateScrollButtons);
    };
  }, [qualifiedBusinesses]);

  // Autoplay functionality: advances one card every 4.5 seconds
  useEffect(() => {
    if (isPaused || isHovered || qualifiedBusinesses.length <= 1) return;

    const interval = setInterval(() => {
      if (!scrollContainerRef.current) return;
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      const isAtEnd = scrollLeft >= scrollWidth - clientWidth - 20;

      if (isAtEnd) {
        scrollContainerRef.current.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        const cardWidth = 340; // Approximate card width + gap
        scrollContainerRef.current.scrollBy({ left: cardWidth, behavior: 'smooth' });
      }
    }, 4500);

    return () => clearInterval(interval);
  }, [isPaused, isHovered, qualifiedBusinesses.length]);

  const handleScroll = (direction: 'left' | 'right') => {
    if (!scrollContainerRef.current) return;
    const cardWidth = 340;
    const amount = direction === 'left' ? -cardWidth : cardWidth;
    scrollContainerRef.current.scrollBy({ left: amount, behavior: 'smooth' });
  };

  if (qualifiedBusinesses.length === 0) {
    return null;
  }

  return (
    <section 
      aria-label="Featured Nigerian Businesses"
      className="relative mb-8 rounded-2xl bg-gradient-to-br from-emerald-950 via-slate-900 to-emerald-900 text-white p-4 sm:p-6 shadow-xl border border-emerald-800/50 overflow-hidden"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Decorative background glow */}
      <div className="absolute top-0 right-0 -mt-12 -mr-12 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-1/3 -mb-16 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header bar with controls */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 mb-4 sm:mb-5 pb-3 border-b border-emerald-800/60">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold shadow-md shadow-amber-400/20 shrink-0">
            <Award className="w-5 h-5 text-slate-950" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-1.5">
                <span>Today’s Featured Businesses</span>
                <Sparkles className="w-4 h-4 text-amber-300 fill-amber-300 hidden sm:inline" />
              </h2>
              <span className="text-[11px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/40 px-2 py-0.5 rounded-full">
                {qualifiedBusinesses.length} picks · {todayLabel}
              </span>
            </div>
            <p className="text-xs text-emerald-200/80 font-medium mt-0.5">
              A fresh random selection of verified businesses, rotated every day at midnight (WAT)
            </p>
          </div>
        </div>

        {/* Carousel controls & filter scope */}
        <div className="flex items-center gap-2 sm:gap-3">
          {hasLocalMatches && selectedState && (
            <div className="flex items-center bg-emerald-900/60 border border-emerald-700/60 rounded-lg p-0.5 text-xs font-semibold">
              <button
                onClick={() => setViewScope('local')}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  viewScope === 'local'
                    ? 'bg-emerald-500 text-slate-950 font-bold shadow'
                    : 'text-emerald-200 hover:text-white'
                }`}
              >
                In {selectedState}
              </button>
              <button
                onClick={() => setViewScope('nationwide')}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  viewScope === 'nationwide'
                    ? 'bg-emerald-500 text-slate-950 font-bold shadow'
                    : 'text-emerald-200 hover:text-white'
                }`}
              >
                Nationwide
              </button>
            </div>
          )}

          {/* Autoplay Pause / Play toggle */}
          <button
            onClick={() => setIsPaused((prev) => !prev)}
            aria-label={isPaused ? 'Resume autoplay' : 'Pause autoplay'}
            className="p-1.5 rounded-lg bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 hover:text-white border border-emerald-700/60 transition cursor-pointer"
            title={isPaused ? 'Play autoplay' : 'Pause autoplay'}
          >
            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </button>

          {/* Left/Right scroll navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleScroll('left')}
              disabled={!canScrollLeft}
              aria-label="Previous featured businesses"
              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                canScrollLeft
                  ? 'bg-emerald-900/80 hover:bg-emerald-700 text-white border-emerald-600 shadow-sm'
                  : 'bg-emerald-950/40 text-emerald-600/60 border-emerald-900/40 cursor-not-allowed opacity-50'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleScroll('right')}
              disabled={!canScrollRight}
              aria-label="Next featured businesses"
              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                canScrollRight
                  ? 'bg-emerald-900/80 hover:bg-emerald-700 text-white border-emerald-600 shadow-sm'
                  : 'bg-emerald-950/40 text-emerald-600/60 border-emerald-900/40 cursor-not-allowed opacity-50'
              }`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Track */}
      <div
        ref={scrollContainerRef}
        className="relative z-10 flex gap-4 overflow-x-auto scrollbar-none snap-x snap-mandatory py-1 px-0.5 focus:outline-none"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') handleScroll('left');
          if (e.key === 'ArrowRight') handleScroll('right');
        }}
      >
        {qualifiedBusinesses.map((biz) => {
          const isSaved = bookmarks.includes(biz.id);
          const whatsappUrl = biz.whatsapp 
            ? formatWhatsAppUrl(biz.whatsapp, biz.name) 
            : (biz.phone ? formatWhatsAppUrl(biz.phone, biz.name) : null);
          const telUrl = biz.phone ? formatTelUrl(biz.phone) : null;

          return (
            <div
              key={biz.id}
              className="group relative flex flex-col justify-between w-[290px] sm:w-[330px] md:w-[350px] shrink-0 bg-slate-900/90 dark:bg-slate-900/95 hover:bg-slate-900 rounded-xl p-4 sm:p-5 border border-emerald-800/60 hover:border-amber-400 transition-all duration-300 shadow-lg hover:shadow-amber-400/10 snap-start"
            >
              {/* Golden Top Accent Line */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400 via-emerald-400 to-teal-400 rounded-t-xl" />

              <div>
                {/* Meta row: Featured Badge + Rating + Bookmark */}
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-[10px] font-black tracking-wider uppercase bg-amber-400/20 text-amber-300 border border-amber-400/40 px-2 py-0.5 rounded">
                      <Sparkles className="w-3 h-3 text-amber-300 fill-amber-300" />
                      Featured
                    </span>

                    {biz.cacNumber && (
                      <span className="text-[10px] font-mono font-bold text-emerald-300 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800/80">
                        {biz.cacNumber}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {/* Share Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onShare(biz);
                      }}
                      title="Share business"
                      className="p-1 text-slate-400 hover:text-white transition cursor-pointer"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                    </button>

                    {/* Bookmark Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleBookmark(biz.id);
                      }}
                      title={isSaved ? 'Remove from saved' : 'Save business'}
                      className={`p-1 transition cursor-pointer ${
                        isSaved ? 'text-amber-400 fill-amber-400' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <Bookmark className={`w-3.5 h-3.5 ${isSaved ? 'fill-amber-400' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* Business Name */}
                <h3 
                  onClick={() => {
                    onSelectBusiness(biz);
                    onViewDetails(biz);
                  }}
                  className="font-bold text-base sm:text-lg text-white group-hover:text-amber-300 transition-colors cursor-pointer line-clamp-1"
                  title={biz.name}
                >
                  {biz.name}
                </h3>

                {/* Rating & Verification Line */}
                <div className="flex items-center gap-2 text-xs text-slate-300 mt-1 mb-2">
                  <div className="flex items-center gap-1 bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-bold text-[11px] border border-amber-500/30">
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                    <span>{ratingSummary(biz).label}</span>
                    {ratingSummary(biz).hasRating && (
                      <span className="text-amber-300/70 font-normal">({biz.reviewsCount.toLocaleString()})</span>
                    )}
                  </div>

                  <span className="text-slate-500">·</span>

                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    Verified
                  </span>

                  <span className="text-slate-500">·</span>

                  <span className="text-[11px] font-semibold text-emerald-400">
                    {biz.category}
                  </span>
                </div>

                {/* Location with Landmark */}
                <div className="flex items-start gap-1.5 text-xs text-slate-300/90 mb-2.5">
                  <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span className="line-clamp-1">
                    {biz.lga ? `${biz.lga}, ` : ''}{biz.state} State
                    {biz.landmark ? ` • Near ${biz.landmark}` : ''}
                  </span>
                </div>

                {/* Short Description */}
                <p className="text-xs text-slate-300/80 line-clamp-2 leading-relaxed mb-3">
                  {biz.description || `Premier verified ${biz.category.toLowerCase()} provider serving ${biz.state} with reliable quality and customer service.`}
                </p>
              </div>

              {/* Action Buttons Row */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5">
                  {/* WhatsApp Direct */}
                  {whatsappUrl && (
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 transition shadow-sm"
                      title="Chat on WhatsApp"
                    >
                      <MessageCircle className="w-3.5 h-3.5 fill-current" />
                      <span className="hidden sm:inline">WhatsApp</span>
                    </a>
                  )}

                  {/* Direct Phone Call */}
                  {telUrl && (
                    <a
                      href={telUrl}
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 transition"
                      title={`Call ${biz.phone}`}
                    >
                      <Phone className="w-3.5 h-3.5" />
                    </a>
                  )}

                  {/* Google Maps link */}
                  {biz.googleMapUrl && (
                    <a
                      href={biz.googleMapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 transition"
                      title="View on Google Maps"
                    >
                      <Navigation className="w-3.5 h-3.5 text-amber-400" />
                    </a>
                  )}
                </div>

                {/* Full Profile & Details Button */}
                <button
                  onClick={() => {
                    onSelectBusiness(biz);
                    onViewDetails(biz);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold text-xs flex items-center gap-1 transition cursor-pointer border border-white/20"
                >
                  <Eye className="w-3.5 h-3.5 text-emerald-300" />
                  <span>View Details</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
