import React, { useCallback, useEffect, useState } from 'react';
import { 
  X, 
  MapPin, 
  Phone, 
  Globe, 
  MessageCircle, 
  Navigation, 
  Star, 
  CheckCircle, 
  Bookmark, 
  Share2, 
  Clock, 
  ShieldCheck, 
  Send,
  Building,
  Flag,
  Info,
  CreditCard,
  ExternalLink,
  Compass,
  ShoppingBag,
  Plus,
  Loader2,
  Trash2,
  AlertCircle,
  Image as ImageIcon,
  Pencil,
  QrCode
} from 'lucide-react';
import { Business, BusinessReview, MarketplaceItem } from '../types';
import { 
  getGoogleMapsEmbedUrl, 
  getGoogleMapsDirectionsUrl, 
  formatWhatsAppUrl, 
  formatTelUrl 
} from '../data/nigeriaData';
import { useAuth } from '../context/AuthContext';
import { useModal } from '../hooks/useModal';
import { addReview, deleteReview, fetchReviews, ValidationError } from '../services/content';
import { friendlyError, logError } from '../lib/errors';
import { ratingSummary } from '../lib/format';
import type { ReportTarget } from './ReportModal';

interface BusinessDetailsModalProps {
  business: Business | null;
  isOpen: boolean;
  onClose: () => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  onShare: () => void;
  onClaim: () => void;
  /** Opens the "report this" dialog (the parent decides whether sign-in is needed first). */
  onReport: (target: ReportTarget) => void;
  marketplaceItems?: MarketplaceItem[];
  onSelectProduct?: (item: MarketplaceItem) => void;
  onPostProductForBusiness?: (business: Business) => void;
  onEdit?: (business: Business) => void;
  onOpenQr?: () => void;
}

const BusinessDetails: React.FC<BusinessDetailsModalProps & { business: Business }> = ({
  business,
  onClose,
  isBookmarked,
  onToggleBookmark,
  onShare,
  onClaim,
  onReport,
  marketplaceItems = [],
  onSelectProduct,
  onPostProductForBusiness,
  onEdit,
  onOpenQr,
}) => {
  useModal(onClose);
  const { currentUser, userProfile, requireMember, isAdmin } = useAuth();

  const [activeTab, setActiveTab] = useState<'overview' | 'marketplace' | 'reviews'>('overview');
  const [reviews, setReviews] = useState<BusinessReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [submittedReview, setSubmittedReview] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const isOwnListing = !!currentUser && business.ownerId === currentUser.uid;
  const alreadyReviewed = !!currentUser && reviews.some((r) => r.authorId === currentUser.uid);
  const rating = ratingSummary(business, reviews);

  const loadReviews = useCallback(async () => {
    try {
      setReviews(await fetchReviews(business.id));
    } catch (err) {
      logError('load reviews', err);
    } finally {
      setReviewsLoading(false);
    }
  }, [business.id]);

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  // Filter items that belong to this business
  const businessProducts = marketplaceItems.filter(
    (item) => item.businessId === business.id || 
      item.businessName.toLowerCase().trim() === business.name.toLowerCase().trim()
  );

  const whatsappUrl = business.whatsapp
    ? formatWhatsAppUrl(business.whatsapp, business.name)
    : (business.phone ? formatWhatsAppUrl(business.phone, business.name) : null);

  const directionsUrl = business.googleMapUrl || getGoogleMapsDirectionsUrl(business.address, business.name, business.state);
  const embedUrl = getGoogleMapsEmbedUrl(business.address, business.name, business.state);

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reviewSaving) return;
    if (!requireMember('write a review') || !currentUser) return;

    setReviewError(null);
    setReviewSaving(true);
    try {
      await addReview(currentUser, userProfile?.displayName, business.id, reviewRating, reviewComment);
      setReviewComment('');
      setSubmittedReview(true);
      setTimeout(() => setSubmittedReview(false), 3000);
      await loadReviews();
    } catch (err) {
      setReviewError(err instanceof ValidationError ? err.message : friendlyError(err, 'We could not save your review. Please try again.'));
    } finally {
      setReviewSaving(false);
    }
  };

  const handleDeleteReview = async (review: BusinessReview) => {
    if (!window.confirm('Delete this review?')) return;
    try {
      await deleteReview(review.id);
      await loadReviews();
    } catch (err) {
      setReviewError(friendlyError(err, 'We could not delete that review.'));
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div 
        role="dialog"
        aria-modal="true"
        aria-label={`${business.name} details`}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden my-6 max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header Banner */}
        <div className="relative bg-gradient-to-r from-emerald-900 via-emerald-800 to-teal-900 text-white p-5 sm:p-6 shrink-0">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-white/80 hover:text-white bg-black/20 hover:bg-black/40 rounded-full transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pr-8">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-300 bg-emerald-950/80 px-2.5 py-0.5 rounded">
                  {business.category}
                </span>

                {business.cacNumber && business.isVerified && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-200 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-500/50 font-mono">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                    CAC: {business.cacNumber}
                  </span>
                )}
                {business.cacNumber && !business.isVerified && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-300 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-500/50 font-mono" title="Provided by the business owner and not yet verified by NaijaPages">
                    CAC (unverified): {business.cacNumber}
                  </span>
                )}

                {business.isVerified && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-200 bg-emerald-900/80 px-2.5 py-0.5 rounded border border-emerald-500/50">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    Verified Listing
                  </span>
                )}

                {business.originType === 'bot_discovered' && !business.isVerified && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-200 bg-slate-900/70 px-2.5 py-0.5 rounded border border-white/20">
                    Unverified · Public Directory Record
                  </span>
                )}

                {business.yearEstablished && (
                  <span className="text-xs font-semibold text-emerald-200/90 bg-emerald-950/60 px-2 py-0.5 rounded">
                    Est. {business.yearEstablished}
                  </span>
                )}

                {business.priceLevel && (
                  <span className="text-xs font-bold text-amber-300">
                    {business.priceLevel}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 mt-2">
                {business.logoUrl && (
                  <img
                    src={business.logoUrl}
                    alt={`${business.name} logo`}
                    className="w-12 h-12 rounded-xl object-cover border border-white/25 bg-white/10 shrink-0"
                  />
                )}
                <h2 className="text-xl sm:text-2xl lg:text-3xl font-black tracking-tight">
                  {business.name}
                </h2>
              </div>

              <p className="flex items-center gap-1.5 text-xs sm:text-sm text-emerald-100/90 mt-1 font-medium">
                <MapPin className="w-4 h-4 text-emerald-300 shrink-0" />
                <span>{business.address}, {business.lga ? `${business.lga}, ` : ''}{business.state} State</span>
              </p>

              {business.landmark && (
                <p className="flex items-center gap-1 text-xs text-amber-200 mt-1 font-medium">
                  <Compass className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span>Landmark: {business.landmark}</span>
                </p>
              )}
            </div>

            {/* Rating Box */}
            <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 bg-emerald-950/60 p-3 rounded-xl border border-emerald-600/30 shrink-0">
              <div className="flex items-center gap-1.5">
                <Star className="w-5 h-5 fill-amber-400 text-amber-400" />
                <span className="text-xl font-black">{rating.label}</span>
              </div>
              <span className="text-[11px] text-emerald-200/90 font-medium">
                {rating.hasRating ? `${rating.count} customer rating${rating.count === 1 ? '' : 's'}` : 'No ratings yet'}
              </span>
            </div>
          </div>

          {/* Quick Action Bar in Header */}
          <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-emerald-700/50">
            {whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-[#25D366] hover:bg-[#20ba59] text-white text-xs sm:text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-sm transition-colors"
              >
                <MessageCircle className="w-4 h-4 fill-current" />
                <span>Chat on WhatsApp</span>
              </a>
            )}

            {business.phone && (
              <a
                href={formatTelUrl(business.phone)}
                className="bg-white text-emerald-950 hover:bg-emerald-50 text-xs sm:text-sm font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-sm transition-colors"
              >
                <Phone className="w-4 h-4 text-emerald-700" />
                <span>Call {business.phone}</span>
              </a>
            )}

            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-emerald-800/80 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 border border-emerald-600 transition-colors"
            >
              <Navigation className="w-4 h-4" />
              <span>Directions</span>
            </a>

            {business.website && (
              <a
                href={business.website}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-emerald-800/80 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold px-3 py-2 rounded-xl flex items-center gap-1.5 border border-emerald-600 transition-colors"
              >
                <Globe className="w-4 h-4" />
                <span>Website</span>
              </a>
            )}

            <div className="ml-auto flex items-center gap-2">
              {onOpenQr && (
                <button
                  type="button"
                  onClick={onOpenQr}
                  className="bg-emerald-950/70 hover:bg-emerald-800 text-white text-xs sm:text-sm font-bold px-3 py-2 rounded-xl flex items-center gap-1.5 border border-emerald-500/70 transition-colors cursor-pointer whitespace-nowrap"
                  title="Generate scannable QR code for WhatsApp or Website"
                >
                  <QrCode className="w-4 h-4 text-emerald-300" />
                  <span>QR Code</span>
                </button>
              )}

              {(isOwnListing || isAdmin) && onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(business)}
                  className="bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer whitespace-nowrap"
                  title="Edit business listing"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
              )}

              <button
                type="button"
                onClick={onToggleBookmark}
                className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                  isBookmarked
                    ? 'bg-amber-500 text-white border-amber-400'
                    : 'bg-emerald-950/60 text-white/90 hover:text-white border-emerald-600 hover:bg-emerald-800/80'
                }`}
                title={isBookmarked ? 'Remove bookmark' : 'Bookmark this business'}
                aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this business'}
              >
                <Bookmark className={`w-4 h-4 ${isBookmarked ? 'fill-current' : ''}`} />
              </button>

              <button
                type="button"
                onClick={onShare}
                className="p-2 bg-emerald-950/60 text-white/90 hover:text-white border border-emerald-600 hover:bg-emerald-800/80 rounded-xl transition-colors cursor-pointer"
                title="Share business profile"
                aria-label="Share business profile"
              >
                <Share2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="flex items-center gap-1 px-5 pt-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 overflow-x-auto shrink-0">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'overview'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Info className="w-4 h-4" />
            <span>Overview & Info</span>
          </button>

          <button
            onClick={() => setActiveTab('marketplace')}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'marketplace'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <ShoppingBag className="w-4 h-4 text-amber-500" />
            <span>Storefront / Marketplace</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
              businessProducts.length > 0 ? 'bg-amber-400 text-slate-950' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
            }`}>
              {businessProducts.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('reviews')}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'reviews'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Star className="w-4 h-4 text-amber-500" />
            <span>Reviews ({reviews.length})</span>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1 text-slate-800 dark:text-slate-200">
          
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* About / Description */}
              <div>
                <h3 className="font-bold text-sm text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-emerald-600" />
                  About This Business
                </h3>
                <p className="text-sm sm:text-base leading-relaxed text-slate-700 dark:text-slate-300">
                  {business.description ||
                    `${business.name} is a ${business.category} listing in ${business.lga ? business.lga + ', ' : ''}${business.state} State, Nigeria.`}
                </p>

                {business.sourceAttribution && (
                  <div className="mt-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Data attribution:{' '}
                      {business.sourceLicenceUrl ? (
                        <a
                          href={business.sourceLicenceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-emerald-700 dark:text-emerald-400 underline"
                        >
                          {business.sourceAttribution}
                        </a>
                      ) : (
                        <span className="font-semibold">{business.sourceAttribution}</span>
                      )}
                    </span>
                    {!business.isVerified && (
                      <span className="text-slate-500 dark:text-slate-400">
                        Not yet owner-verified — claim listing to verify details
                      </span>
                    )}
                  </div>
                )}

                {business.tags && business.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {business.tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Business Cover Photo & Gallery */}
              {(business.coverImageUrl || (business.gallery && business.gallery.length > 0)) && (
                <div className="space-y-3">
                  <h3 className="font-bold text-sm text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <ImageIcon className="w-4 h-4 text-emerald-600" />
                    Business Photos
                  </h3>
                  {business.coverImageUrl && (
                    <div className="w-full h-48 sm:h-60 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950">
                      <img
                        src={business.coverImageUrl}
                        alt={`${business.name} cover`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  {business.gallery && business.gallery.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {business.gallery.map((photoUrl, idx) => (
                        <a
                          key={`${photoUrl}-${idx}`}
                          href={photoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block h-28 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 hover:opacity-95 transition"
                        >
                          <img
                            src={photoUrl}
                            alt={`${business.name} photo ${idx + 1}`}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Location & Operating Hours Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Hours */}
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-emerald-600" />
                    Working Hours
                  </h4>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {business.openingHours || 'Opening hours not yet published'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Confirm directly with the business before visiting on public holidays.
                  </p>
                </div>

                {/* Jurisdiction / Region */}
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Building className="w-4 h-4 text-emerald-600" />
                    Regional Jurisdiction
                  </h4>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {business.lga ? `${business.lga} Local Government Area` : 'Central District'}, {business.state} State
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Federal Republic of Nigeria
                  </p>
                </div>
              </div>

              {/* Social Media Handles (If Available) */}
              {business.socials && Object.values(business.socials).some(Boolean) && (
                <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2.5">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Share2 className="w-4 h-4 text-emerald-600" />
                    Connect on Social Media
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {business.socials.instagram && (
                      <a
                        href={business.socials.instagram}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-purple-600 via-pink-600 to-amber-500 shadow-xs hover:opacity-95 transition"
                      >
                        <span>Instagram</span>
                        <ExternalLink size={12} />
                      </a>
                    )}

                    {business.socials.twitter && (
                      <a
                        href={business.socials.twitter}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-slate-900 dark:bg-slate-800 border border-slate-700 shadow-xs hover:bg-black transition"
                      >
                        <span>X (Twitter)</span>
                        <ExternalLink size={12} />
                      </a>
                    )}

                    {business.socials.facebook && (
                      <a
                        href={business.socials.facebook}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-[#1877F2] hover:bg-[#166fe5] shadow-xs transition"
                      >
                        <span>Facebook</span>
                        <ExternalLink size={12} />
                      </a>
                    )}

                    {business.socials.linkedin && (
                      <a
                        href={business.socials.linkedin}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-[#0A66C2] hover:bg-[#084e96] shadow-xs transition"
                      >
                        <span>LinkedIn</span>
                        <ExternalLink size={12} />
                      </a>
                    )}

                    {business.socials.tiktok && (
                      <a
                        href={business.socials.tiktok}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-black hover:bg-neutral-800 shadow-xs transition"
                      >
                        <span>TikTok</span>
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Accepted Payment Rails */}
              {business.paymentMethods && business.paymentMethods.length > 0 && (
                <div className="p-4 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-xl border border-emerald-200/50 dark:border-emerald-800/40 space-y-2">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                    <CreditCard className="w-4 h-4 text-emerald-600" />
                    Accepted Nigerian Payment Methods
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {business.paymentMethods.map((pm, idx) => (
                      <span
                        key={idx}
                        className="text-xs font-semibold px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-emerald-200 dark:border-emerald-800"
                      >
                        ✓ {pm}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Embedded Interactive Map */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-sm text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-emerald-600" />
                    Location & Map Directions
                  </h3>
                  <a
                    href={directionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                  >
                    <span>Open in Google Maps App</span>
                    <Navigation className="w-3 h-3" />
                  </a>
                </div>
                <div className="w-full h-56 sm:h-64 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-inner bg-slate-100 dark:bg-slate-950">
                  <iframe
                    src={embedUrl}
                    title={`${business.name} location`}
                    className="w-full h-full border-0"
                    loading="lazy"
                    allowFullScreen
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: MARKETPLACE / STOREFRONT */}
          {activeTab === 'marketplace' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-emerald-600" />
                    Storefront Inventory & Products for Sale
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Direct classifieds listings powered by NaijaPages Marketplace
                  </p>
                </div>

                {onPostProductForBusiness && (
                  <button
                    onClick={() => onPostProductForBusiness(business)}
                    className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg shadow-sm transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[3]" />
                    <span>Post Item</span>
                  </button>
                )}
              </div>

              {businessProducts.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {businessProducts.map((prod) => {
                    const prodPrice = new Intl.NumberFormat('en-NG', {
                      style: 'currency',
                      currency: 'NGN',
                      maximumFractionDigits: 0,
                    }).format(prod.price);

                    const prodWhatsapp = prod.whatsapp || prod.phone;

                    return (
                      <div
                        key={prod.id}
                        onClick={() => onSelectProduct && onSelectProduct(prod)}
                        className="group bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 p-3 flex gap-3 hover:border-emerald-500 transition-all cursor-pointer"
                      >
                        <div className="w-24 h-24 rounded-lg bg-slate-200 dark:bg-slate-700 overflow-hidden shrink-0 relative">
                          <img
                            src={prod.imageUrl}
                            alt={prod.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                          <span className="absolute bottom-1 left-1 text-[9px] font-bold bg-black/70 text-white px-1.5 py-0.2 rounded">
                            {prod.condition}
                          </span>
                        </div>

                        <div className="flex-1 flex flex-col justify-between">
                          <div>
                            <div className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                              {prodPrice}
                            </div>
                            <h4 className="text-xs font-bold text-slate-900 dark:text-white line-clamp-2 mt-0.5">
                              {prod.title}
                            </h4>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700 text-xs">
                            <span className="text-[11px] text-slate-500">
                              {prod.category}
                            </span>
                            {prodWhatsapp && (
                              <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                <MessageCircle className="w-3 h-3 fill-current" />
                                <span>WhatsApp</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center mx-auto text-xl">
                    🛍️
                  </div>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                    No marketplace items currently listed for {business.name}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                    Are you the manager or owner of this business? You can list your products, inventory, or services directly on the NaijaPages marketplace.
                  </p>
                  {onPostProductForBusiness && (
                    <button
                      onClick={() => onPostProductForBusiness(business)}
                      className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-lg shadow-sm transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>List First Product for this Business</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: REVIEWS */}
          {activeTab === 'reviews' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                  <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
                  Customer Reviews ({reviews.length})
                </h3>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Verified community feedback
                </span>
              </div>

              {reviewError && (
                <div role="alert" className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{reviewError}</span>
                </div>
              )}

              {/* List Existing Reviews */}
              {reviewsLoading ? (
                <div className="py-6 flex justify-center text-emerald-600"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : reviews.length > 0 ? (
                <div className="space-y-3">
                  {reviews.map((rev) => (
                    <div 
                      key={rev.id} 
                      className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-slate-800 dark:text-slate-200">
                          {rev.author}
                        </span>
                        <div className="flex items-center gap-1 text-xs font-bold text-amber-600 dark:text-amber-400">
                          <Star className="w-3.5 h-3.5 fill-current" />
                          <span>{rev.rating} / 5</span>
                        </div>
                      </div>
                      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line break-words">
                        {rev.comment}
                      </p>
                      <div className="flex items-center justify-between pt-0.5">
                        <p className="text-[10px] text-slate-400">{rev.date}</p>
                        <div className="flex items-center gap-3">
                          {currentUser && rev.authorId !== currentUser.uid && (
                            <button
                              type="button"
                              onClick={() => onReport({ type: 'review', id: rev.id, title: `Review by ${rev.author} on ${business.name}` })}
                              className="text-[10px] font-semibold text-slate-400 hover:text-rose-600 flex items-center gap-1 cursor-pointer"
                            >
                              <Flag className="w-3 h-3" /> Report
                            </button>
                          )}
                          {currentUser && (rev.authorId === currentUser.uid || isAdmin) && (
                            <button
                              type="button"
                              onClick={() => handleDeleteReview(rev)}
                              className="text-[10px] font-semibold text-slate-400 hover:text-rose-600 flex items-center gap-1 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" /> Delete
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic bg-slate-50 dark:bg-slate-800/30 p-3 rounded-lg border border-dashed border-slate-200 dark:border-slate-800">
                  No user reviews yet. Be the first to share your experience with {business.name}!
                </p>
              )}

              {/* Add Review: members only, one review each */}
              {isOwnListing ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                  You can’t review your own business.
                </p>
              ) : alreadyReviewed ? (
                <p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-lg border border-emerald-200 dark:border-emerald-900 flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5" /> Thanks, you’ve already reviewed this business.
                </p>
              ) : !currentUser ? (
                <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <p className="text-xs text-slate-600 dark:text-slate-300">Sign in to rate and review this business. Only registered members can post reviews.</p>
                  <button type="button" onClick={() => requireMember('write a review')} className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-lg cursor-pointer">
                    Sign in to review
                  </button>
                </div>
              ) : (
                <form onSubmit={handleReviewSubmit} className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Write a Review
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Posting as <b>{userProfile?.displayName || currentUser.email?.split('@')[0] || 'Member'}</b>
                  </p>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      Your Rating *
                    </label>
                    <div className="flex items-center gap-2 pt-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          type="button"
                          key={star}
                          onClick={() => setReviewRating(star)}
                          aria-label={`${star} star${star === 1 ? '' : 's'}`}
                          className="cursor-pointer transition-transform hover:scale-110"
                        >
                          <Star
                            className={`w-5 h-5 ${
                              star <= reviewRating
                                ? 'fill-amber-400 text-amber-500'
                                : 'text-slate-300 dark:text-slate-600'
                            }`}
                          />
                        </button>
                      ))}
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-300 ml-1">
                        {reviewRating} out of 5
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1" htmlFor="review-comment">
                      Your Review / Experience *
                    </label>
                    <textarea
                      id="review-comment"
                      required
                      rows={2}
                      maxLength={1000}
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      placeholder="Tell others about their service quality, promptness, and atmosphere..."
                      className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none focus:border-emerald-500 text-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    {submittedReview ? (
                      <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" /> Thank you! Review submitted.
                      </span>
                    ) : <span />}

                    <button
                      type="submit"
                      disabled={reviewSaving}
                      className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs px-4 py-2 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      {reviewSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      <span>Submit Review</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Claim / Report listing */}
          <div className="p-4 bg-amber-50/60 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <Flag className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="text-amber-800 dark:text-amber-300">
                {business.claimed ? <>This listing’s owner has been verified.</> : <>Do you own or manage <b>{business.name}</b>?</>}
              </span>
            </div>
            <div className="flex items-center gap-4">
              {!business.claimed && !isOwnListing && (
                <button
                  onClick={onClaim}
                  className="text-emerald-700 dark:text-emerald-400 font-bold hover:underline cursor-pointer text-left sm:text-right"
                >
                  Claim this listing →
                </button>
              )}
              {!isOwnListing && (
                <button
                  onClick={() => onReport({ type: 'business', id: business.id, title: business.name })}
                  className="text-slate-500 dark:text-slate-400 font-semibold hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer flex items-center gap-1"
                >
                  <Flag className="w-3.5 h-3.5" /> Report listing
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const BusinessDetailsModal: React.FC<BusinessDetailsModalProps> = (props) =>
  props.isOpen && props.business ? <BusinessDetails {...props} business={props.business} /> : null;
