import React from 'react';
import { ratingSummary } from '../lib/format';
import { 
  CheckCircle, 
  Star, 
  MapPin, 
  Phone, 
  Globe, 
  Bookmark, 
  Share2, 
  ExternalLink,
  MessageCircle,
  Eye,
  Clock,
  Navigation
} from 'lucide-react';
import { Business } from '../types';
import { formatWhatsAppUrl, formatTelUrl } from '../data/nigeriaData';

interface BusinessCardProps {
  business: Business;
  index: number;
  isSelected: boolean;
  isBookmarked: boolean;
  onSelect: () => void;
  onViewDetails: () => void;
  onToggleBookmark: () => void;
  onShare: () => void;
}

export const BusinessCard: React.FC<BusinessCardProps> = ({
  business,
  index,
  isSelected,
  isBookmarked,
  onSelect,
  onViewDetails,
  onToggleBookmark,
  onShare,
}) => {
  const whatsappUrl = business.whatsapp 
    ? formatWhatsAppUrl(business.whatsapp, business.name) 
    : (business.phone ? formatWhatsAppUrl(business.phone, business.name) : null);

  return (
    <article 
      onClick={onSelect}
      className={`group relative bg-white dark:bg-slate-900 rounded-xl p-4 sm:p-5 border transition-all cursor-pointer ${
        isSelected 
          ? 'border-emerald-600 ring-2 ring-emerald-500/30 shadow-md bg-emerald-50/20 dark:bg-emerald-950/20' 
          : 'border-slate-200 dark:border-slate-800 hover:border-emerald-400 dark:hover:border-emerald-600 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Number Index & Name block */}
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 font-bold text-xs flex items-center justify-center shrink-0 border border-emerald-200 dark:border-emerald-800">
            {index + 1}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-base sm:text-lg text-slate-900 dark:text-white truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                {business.name}
              </h3>

              {business.isVerified && (
                <span 
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 shrink-0"
                  title="Verified Nigerian Business"
                >
                  <CheckCircle className="w-3 h-3 text-emerald-600 fill-emerald-100 dark:fill-emerald-950" />
                  Verified
                </span>
              )}

              {business.isUserAdded && (
                <span className="text-[10px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                  Community Added
                </span>
              )}

              {business.cacNumber && business.isVerified && (
                <span className="text-[10px] font-mono font-bold text-amber-800 dark:text-amber-300 bg-amber-100/70 dark:bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-800">
                  {business.cacNumber}
                </span>
              )}
            </div>

            {/* Category & Location Line */}
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1 flex-wrap font-medium">
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">{business.category}</span>
              <span>•</span>
              <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>{business.lga ? `${business.lga}, ` : ''}{business.state} State</span>
              </span>
            </div>
          </div>
        </div>

        {/* Rating and Bookmark Top Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1 bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60 px-2 py-0.5 rounded text-xs font-bold">
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
            <span>{ratingSummary(business).label}</span>
            {ratingSummary(business).hasRating && (
              <span className="text-[10px] text-amber-600/70 dark:text-amber-400/70 font-normal">({business.reviewsCount})</span>
            )}
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleBookmark();
            }}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              isBookmarked
                ? 'bg-amber-500 text-white border-amber-600'
                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title={isBookmarked ? 'Remove bookmark' : 'Save business'}
            aria-label="Bookmark"
          >
            <Bookmark className={`w-3.5 h-3.5 ${isBookmarked ? 'fill-current' : ''}`} />
          </button>
        </div>
      </div>

      {/* Address line */}
      <p className="text-xs text-slate-600 dark:text-slate-400 mt-2.5 line-clamp-1">
        {business.address}
      </p>

      {/* Description if present */}
      {business.description && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
          {business.description}
        </p>
      )}

      {/* Tags line */}
      {business.tags && business.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {business.tags.slice(0, 3).map((tag, idx) => (
            <span 
              key={idx}
              className="text-[10px] font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded"
            >
              #{tag}
            </span>
          ))}
          {business.tags.length > 3 && (
            <span className="text-[10px] text-slate-400 self-center">
              +{business.tags.length - 3} more
            </span>
          )}
        </div>
      )}

      {/* Action Buttons Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-1.5">
          {/* WhatsApp Direct Button */}
          {whatsappUrl && (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 bg-[#25D366] hover:bg-[#20ba59] text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-xs transition-colors"
              title="Chat with business on WhatsApp"
            >
              <MessageCircle className="w-3.5 h-3.5 fill-current" />
              <span>WhatsApp</span>
            </a>
          )}

          {/* Call Phone Button */}
          {business.phone && (
            <a
              href={formatTelUrl(business.phone)}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors"
              title={`Call ${business.phone}`}
            >
              <Phone className="w-3.5 h-3.5 text-emerald-600" />
              <span className="hidden sm:inline">Call</span>
            </a>
          )}

          {/* Website if available */}
          {business.website && (
            <a
              href={business.website}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors"
              title="Visit official website"
            >
              <Globe className="w-3.5 h-3.5 text-blue-500" />
              <span className="hidden sm:inline">Web</span>
            </a>
          )}

          {/* Google Maps Pin */}
          {business.googleMapUrl && (
            <a
              href={business.googleMapUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900 text-amber-800 dark:text-amber-300 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800 transition-colors"
              title="Open Google Maps location"
            >
              <Navigation className="w-3.5 h-3.5 text-amber-600" />
              <span className="hidden sm:inline">Map</span>
            </a>
          )}
        </div>

        {/* View Details / Share */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onShare();
            }}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title="Share listing"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewDetails();
            }}
            className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800/80 transition-colors cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Profile & Map</span>
          </button>
        </div>
      </div>
    </article>
  );
};
