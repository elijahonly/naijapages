import React from 'react';
import { 
  MapPin, 
  Phone, 
  MessageCircle, 
  ShieldCheck, 
  Eye, 
  Clock, 
  Sparkles,
  Tag
} from 'lucide-react';
import { MarketplaceItem } from '../types';
import { formatWhatsAppUrl, formatTelUrl } from '../data/nigeriaData';

interface MarketplaceCardProps {
  item: MarketplaceItem;
  onSelect: (item: MarketplaceItem) => void;
  onOpenSellerBusiness?: (businessId: string) => void;
}

export const MarketplaceCard: React.FC<MarketplaceCardProps> = ({
  item,
  onSelect,
  onOpenSellerBusiness,
}) => {
  const formattedPrice = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(item.price);

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

  const prefilledWhatsappMsg = `Hello, I saw your listing for "${item.title}" listed for ${formattedPrice} on NaijaPages Marketplace. Is it still available?`;
  const whatsappUrl = item.whatsapp
    ? `https://wa.me/${item.whatsapp.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(prefilledWhatsappMsg)}`
    : (item.phone ? `https://wa.me/${item.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(prefilledWhatsappMsg)}` : null);

  const telUrl = formatTelUrl(item.phone);

  return (
    <div 
      onClick={() => onSelect(item)}
      className="group bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500/50 dark:hover:border-emerald-500/50 shadow-xs hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col cursor-pointer relative"
    >
      {/* Product Image Area */}
      <div className="relative aspect-4/3 w-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <img
          src={item.imageUrl}
          alt={item.title}
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          onError={(e) => {
            // Fallback image if broken
            (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1526738549149-8e07eca6c147?w=800&auto=format&fit=crop&q=80';
          }}
        />

        {/* Condition Tag */}
        <div className="absolute top-2 left-2 z-10">
          <span className={`text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-md shadow-xs ${getConditionColor(item.condition)}`}>
            {item.condition}
          </span>
        </div>

        {/* Featured Tag */}
        {item.featured && (
          <div className="absolute top-2 right-2 z-10">
            <span className="inline-flex items-center gap-1 text-[10px] font-extrabold bg-amber-400 text-slate-900 px-2 py-0.5 rounded-md shadow-xs uppercase tracking-wider">
              <Sparkles className="w-3 h-3 fill-current" />
              TOP
            </span>
          </div>
        )}

        {/* Bottom image overlay with views & time */}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-2 flex items-center justify-between text-[11px] text-white/90">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-slate-300" />
            <span>{item.postedDate}</span>
          </span>
          {item.viewsCount > 0 && (
            <span className="flex items-center gap-1">
              <Eye className="w-3 h-3 text-slate-300" />
              <span>{item.viewsCount} views</span>
            </span>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="p-3.5 flex-1 flex flex-col justify-between">
        <div>
          {/* Price & Negotiable Badge */}
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <div className="text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400">
              {formattedPrice}
            </div>
            {item.isNegotiable ? (
              <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-800">
                Negotiable
              </span>
            ) : (
              <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                Fixed Price
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white line-clamp-2 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors mb-2">
            {item.title}
          </h3>

          {/* Seller Business Info */}
          <div className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 mb-2 truncate">
            {item.isVerifiedSeller && (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            )}
            <span className="font-semibold truncate hover:underline" title={item.businessName}>
              {item.businessName}
            </span>
          </div>

          {/* Location */}
          <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 mb-3 truncate">
            <MapPin className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="truncate">
              {item.locationHub ? item.locationHub : `${item.lga}, ${item.state}`}
            </span>
          </div>
        </div>

        {/* Action Buttons: WhatsApp & Call */}
        <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-2 gap-2">
          {whatsappUrl ? (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center justify-center gap-1 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-600 text-emerald-700 dark:text-emerald-300 hover:text-white py-1.5 px-2 rounded-lg text-xs font-bold border border-emerald-200 dark:border-emerald-800/60 transition-colors"
              title="Chat with seller on WhatsApp"
            >
              <MessageCircle className="w-3.5 h-3.5 fill-current" />
              <span>WhatsApp</span>
            </a>
          ) : (
            <div className="flex items-center justify-center py-1.5 px-2 text-xs font-semibold text-slate-400">
              No chat
            </div>
          )}

          {telUrl ? (
            <a
              href={telUrl}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center justify-center gap-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 py-1.5 px-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 transition-colors"
              title="Call seller"
            >
              <Phone className="w-3.5 h-3.5" />
              <span>Call</span>
            </a>
          ) : (
            <div className="flex items-center justify-center py-1.5 px-2 text-xs font-semibold text-slate-400">
              No phone
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
