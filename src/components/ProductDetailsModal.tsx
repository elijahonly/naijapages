import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useModal } from '../hooks/useModal';
import type { ReportTarget } from './ReportModal';
import { 
  X, 
  MapPin, 
  Phone, 
  MessageCircle, 
  ShieldCheck, 
  Share2, 
  CheckCircle2, 
  Clock, 
  Eye, 
  AlertTriangle, 
  ExternalLink, 
  Building2, 
  Tag, 
  ChevronRight,
  Sparkles,
  Flag
} from 'lucide-react';
import { MarketplaceItem } from '../types';
import { MARKETPLACE_SAFETY_TIPS } from '../data/marketplaceData';
import { formatTelUrl } from '../data/nigeriaData';

interface ProductDetailsModalProps {
  item: MarketplaceItem | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenSellerBusiness?: (businessId: string) => void;
  onShare?: (item: MarketplaceItem) => void;
  /** Opens the "report this ad" dialog. */
  onReport?: (target: ReportTarget) => void;
}

const ProductDetails: React.FC<ProductDetailsModalProps & { item: MarketplaceItem }> = ({
  item,
  onClose,
  onOpenSellerBusiness,
  onShare,
  onReport,
}) => {
  useModal(onClose);
  const { currentUser } = useAuth();

  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);

  const images = item.additionalImages && item.additionalImages.length > 0
    ? [item.imageUrl, ...item.additionalImages.filter(img => img !== item.imageUrl)]
    : [item.imageUrl];

  const formattedPrice = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(item.price);

  const prefilledWhatsappMsg = `Hello ${item.businessName}, I am contacting you from NaijaPages Marketplace about your listing: "${item.title}" priced at ${formattedPrice}. Is it still available?`;
  const whatsappUrl = item.whatsapp
    ? `https://wa.me/${item.whatsapp.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(prefilledWhatsappMsg)}`
    : (item.phone ? `https://wa.me/${item.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(prefilledWhatsappMsg)}` : null);

  const telUrl = formatTelUrl(item.phone);

  const handleShareClick = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
    if (onShare) {
      onShare(item);
    }
  };

  const getConditionColor = (cond: string) => {
    switch (cond) {
      case 'Brand New':
        return 'bg-emerald-600 text-white';
      case 'Foreign Used (Tokunbo)':
        return 'bg-blue-600 text-white';
      case 'Nigerian Used':
        return 'bg-amber-600 text-white';
      case 'Refurbished':
        return 'bg-purple-600 text-white';
      default:
        return 'bg-slate-700 text-white';
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden my-6 max-h-[94vh] flex flex-col"
        role="dialog" aria-modal="true" aria-label="Ad details"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950 px-2.5 py-0.5 rounded">
              {item.category}
            </span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${getConditionColor(item.condition)}`}>
              {item.condition}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleShareClick}
              className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors cursor-pointer flex items-center gap-1 text-xs"
              title="Share Listing"
            >
              <Share2 className="w-4 h-4" />
              {copiedLink && <span className="text-emerald-600 font-bold text-xs">Link Copied!</span>}
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body: Scrollable */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left Column: Image Gallery & Description (7 cols) */}
            <div className="lg:col-span-7 space-y-4">
              {/* Main Image */}
              <div className="relative aspect-4/3 w-full bg-slate-900 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800">
                <img
                  src={images[activeImageIndex] || item.imageUrl}
                  alt={item.title}
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1526738549149-8e07eca6c147?w=800&auto=format&fit=crop&q=80';
                  }}
                />

                {item.featured && (
                  <div className="absolute top-3 left-3">
                    <span className="inline-flex items-center gap-1 text-xs font-black bg-amber-400 text-slate-900 px-2.5 py-1 rounded-md shadow-md">
                      <Sparkles className="w-3.5 h-3.5 fill-current" />
                      FEATURED AD
                    </span>
                  </div>
                )}
              </div>

              {/* Thumbnails if multiple */}
              {images.length > 1 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {images.map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => setActiveImageIndex(idx)}
                      className={`relative w-16 h-16 rounded-lg overflow-hidden shrink-0 border-2 transition-all cursor-pointer ${
                        activeImageIndex === idx
                          ? 'border-emerald-600 scale-105 shadow-xs'
                          : 'border-transparent opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img src={img} alt={`Thumbnail ${idx}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              {/* Item Attributes / Specifications Grid */}
              {item.attributes && Object.keys(item.attributes).length > 0 && (
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200 dark:border-slate-800">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
                    Item Specifications
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 text-xs">
                    {Object.entries(item.attributes).map(([key, value]) => (
                      <div key={key} className="flex flex-col">
                        <span className="text-slate-500 dark:text-slate-400">{key}</span>
                        <span className="font-bold text-slate-900 dark:text-white mt-0.5">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Description */}
              <div className="space-y-2">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  Description
                </h4>
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                  {item.description}
                </p>
              </div>

              {/* Safety Notice Banner */}
              <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <h5 className="font-bold text-amber-900 dark:text-amber-200">
                    NaijaPages Buyer Safety Rules
                  </h5>
                  <p className="text-amber-800 dark:text-amber-300/90 leading-normal">
                    Never send money in advance before physical inspection. Meet the seller at a busy public spot (e.g. Banex Plaza, Computer Village, or Bank premises).
                  </p>
                </div>
              </div>
            </div>

            {/* Right Column: Pricing, Contact & Seller Info (5 cols) */}
            <div className="lg:col-span-5 space-y-4">
              {/* Price Box */}
              <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl sm:text-3xl font-black text-emerald-600 dark:text-emerald-400">
                    {formattedPrice}
                  </span>
                  {item.isNegotiable && (
                    <span className="text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/80 px-2 py-0.5 rounded-full border border-amber-300 dark:border-amber-800">
                      Negotiable
                    </span>
                  )}
                </div>

                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-snug">
                  {item.title}
                </h2>

                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <MapPin className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="font-medium">
                    {item.locationHub ? `${item.locationHub}, ` : ''}{item.lga}, {item.state} State
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                  <span>Posted {item.postedDate}</span>
                  {item.viewsCount > 0 ? <span>{item.viewsCount} total views</span> : <span />}
                </div>
              </div>

              {/* Direct CTAs */}
              <div className="space-y-2">
                {whatsappUrl && (
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-4 rounded-xl shadow-md shadow-emerald-600/20 hover:shadow-lg transition-all text-sm cursor-pointer"
                  >
                    <MessageCircle className="w-5 h-5 fill-current" />
                    <span>Chat with Seller on WhatsApp</span>
                  </a>
                )}

                {telUrl && (
                  <a
                    href={telUrl}
                    className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-bold py-3 px-4 rounded-xl shadow-sm transition-all text-sm cursor-pointer"
                  >
                    <Phone className="w-4 h-4" />
                    <span>Call Seller: {item.phone}</span>
                  </a>
                )}
              </div>

              {/* Seller Business Profile Card */}
              <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-4 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-base shadow-xs shrink-0">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-1">
                        {item.businessName}
                        {item.isVerifiedSeller && (
                          <span title="Verified Merchant">
                            <ShieldCheck className="w-4 h-4 text-emerald-500 inline" />
                          </span>
                        )}
                      </h4>
                      <p className={`text-[11px] font-semibold ${item.isVerifiedSeller ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                        {item.isVerifiedSeller ? 'Verified Business Seller' : 'Community Seller'}
                      </p>
                    </div>
                  </div>
                </div>

                {item.cacNumber && (
                  <div className="text-xs bg-white dark:bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                    <span className="text-slate-500">{item.isVerifiedSeller ? 'CAC Registration:' : 'CAC (unverified):'}</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{item.cacNumber}</span>
                  </div>
                )}

                {/* If seller is linked to a business directory entry */}
                {item.businessId && onOpenSellerBusiness && (
                  <button
                    onClick={() => {
                      onClose();
                      onOpenSellerBusiness(item.businessId!);
                    }}
                    className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-950/80 hover:bg-emerald-200 dark:hover:bg-emerald-900/80 py-2 rounded-lg border border-emerald-300 dark:border-emerald-800 transition-colors cursor-pointer"
                  >
                    <span>View Merchant's Full Directory Page</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Safety Tips Accordion / Quick List */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 text-xs space-y-2">
                <h5 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  <span>Safe Trading Guidelines</span>
                </h5>
                <ul className="space-y-1.5 text-slate-600 dark:text-slate-400 pl-1">
                  {MARKETPLACE_SAFETY_TIPS.map((tip, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="text-emerald-600 font-bold">•</span>
                      <span><strong>{tip.title}:</strong> {tip.desc}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {onReport && item.ownerId !== currentUser?.uid && (
                <button
                  type="button"
                  onClick={() => onReport({ type: 'ad', id: item.id, title: item.title })}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 hover:border-rose-300 transition-colors cursor-pointer"
                >
                  <Flag className="w-3.5 h-3.5" />
                  <span>Report this ad (scam, fake, prohibited…)</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ProductDetailsModal: React.FC<ProductDetailsModalProps> = (props) =>
  props.isOpen && props.item ? <ProductDetails {...props} item={props.item} /> : null;
