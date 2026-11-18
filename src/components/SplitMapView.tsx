import React from 'react';
import { ratingSummary } from '../lib/format';
import { 
  MapPin, 
  Navigation, 
  ExternalLink, 
  MessageCircle, 
  Phone, 
  Star, 
  ShieldCheck, 
  Maximize2 
} from 'lucide-react';
import { Business } from '../types';
import { 
  getGoogleMapsEmbedUrl, 
  getGoogleMapsDirectionsUrl, 
  formatWhatsAppUrl, 
  formatTelUrl 
} from '../data/nigeriaData';

interface SplitMapViewProps {
  selectedBusiness: Business | null;
  activeState: string;
  onViewDetails: (business: Business) => void;
}

export const SplitMapView: React.FC<SplitMapViewProps> = ({
  selectedBusiness,
  activeState,
  onViewDetails,
}) => {
  // Compute embed URL based on selected business or active state filter
  const embedUrl = selectedBusiness
    ? getGoogleMapsEmbedUrl(selectedBusiness.address, selectedBusiness.name, selectedBusiness.state)
    : `https://maps.google.com/maps?q=${encodeURIComponent(
        activeState ? `${activeState} State, Nigeria` : 'Nigeria'
      )}&t=&z=${activeState ? '9' : '6'}&ie=UTF8&iwloc=&output=embed`;

  const directionsUrl = selectedBusiness
    ? getGoogleMapsDirectionsUrl(selectedBusiness.address, selectedBusiness.name, selectedBusiness.state)
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        activeState ? `${activeState} State, Nigeria` : 'Nigeria businesses'
      )}`;

  const whatsappUrl = selectedBusiness?.whatsapp
    ? formatWhatsAppUrl(selectedBusiness.whatsapp, selectedBusiness.name)
    : selectedBusiness?.phone
    ? formatWhatsAppUrl(selectedBusiness.phone, selectedBusiness.name)
    : null;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm flex flex-col sticky top-20">
      {/* Map Header */}
      <div className="p-3.5 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-emerald-600" />
          <span className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-100">
            {selectedBusiness ? selectedBusiness.name : (activeState ? `${activeState} State Map` : 'Nigeria Interactive Map')}
          </span>
        </div>

        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300"
          title="Open in Google Maps application"
        >
          <Navigation className="w-3.5 h-3.5" />
          <span>Get Directions</span>
          <ExternalLink className="w-3 h-3 ml-0.5" />
        </a>
      </div>

      {/* Embedded Google Map iframe */}
      <div className="relative w-full h-[320px] sm:h-[400px] bg-slate-100 dark:bg-slate-950">
        <iframe
          src={embedUrl}
          title={selectedBusiness ? selectedBusiness.name : 'Nigeria Business Map'}
          className="w-full h-full border-0"
          loading="lazy"
          allowFullScreen
        />

        {!selectedBusiness && (
          <div className="absolute top-3 left-3 right-3 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 shadow-sm pointer-events-none">
            💡 <b>Tip:</b> Click any business card on the left to pin its exact location and view turn-by-turn directions.
          </div>
        )}
      </div>

      {/* Selected Business Preview Footer Card */}
      {selectedBusiness ? (
        <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <h4 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
                  {selectedBusiness.name}
                </h4>
                {selectedBusiness.isVerified && (
                  <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.2 rounded border border-emerald-200 dark:border-emerald-800">
                    Verified
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {selectedBusiness.address}
              </p>
            </div>

            <div className="flex items-center gap-1 bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded text-xs font-bold border border-amber-200 dark:border-amber-900">
              <Star className="w-3 h-3 fill-amber-400 text-amber-500" />
              <span>{ratingSummary(selectedBusiness).label}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            {whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-[#25D366] hover:bg-[#20ba59] text-white font-bold text-xs py-2 px-3 rounded-lg text-center flex items-center justify-center gap-1.5 transition-colors shadow-xs"
              >
                <MessageCircle className="w-3.5 h-3.5 fill-current" />
                <span>WhatsApp</span>
              </a>
            )}

            {selectedBusiness.phone && (
              <a
                href={formatTelUrl(selectedBusiness.phone)}
                className="flex-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-semibold text-xs py-2 px-3 rounded-lg text-center flex items-center justify-center gap-1.5 border border-slate-200 dark:border-slate-700 transition-colors"
              >
                <Phone className="w-3.5 h-3.5 text-emerald-600" />
                <span>Call Phone</span>
              </a>
            )}

            <button
              onClick={() => onViewDetails(selectedBusiness)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2 px-3.5 rounded-lg transition-colors cursor-pointer"
            >
              Full Profile
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 text-center text-xs text-slate-500 dark:text-slate-400">
          Viewing nationwide business geographic coverage.
        </div>
      )}
    </div>
  );
};
