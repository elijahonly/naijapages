import { useModal } from '../hooks/useModal';
import React, { useState } from 'react';
import { X, Copy, Check, MessageCircle, Share2, Globe, MapPin, Phone, Star } from 'lucide-react';
import { Business } from '../types';

interface ShareBusinessModalProps {
  business: Business | null;
  isOpen: boolean;
  onClose: () => void;
}

const ShareBusiness: React.FC<ShareBusinessModalProps & { business: Business }> = ({
  business,
  onClose,
}) => {
  useModal(onClose);

  const [copied, setCopied] = useState(false);

  const shareText = `Check out ${business.name} on NaijaPages! Category: ${business.category}, located in ${business.lga ? business.lga + ', ' : ''}${business.state} State, Nigeria. Phone: ${business.phone || 'Available on NaijaPages'}.`;
  const shareUrl = window.location.href;

  const handleCopy = () => {
    navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const whatsappShareUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`;
  const twitterShareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden my-6 flex flex-col"
        role="dialog" aria-modal="true" aria-label="Share business"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-emerald-800 text-white p-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-emerald-300" />
            <h3 className="font-extrabold text-base">Share Business Listing</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-white/80 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Digital Business Card Preview */}
        <div className="p-5 space-y-4">
          <div className="bg-gradient-to-br from-slate-900 to-emerald-950 text-white p-4 rounded-xl border border-emerald-500/30 shadow-md space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-bold text-emerald-300 uppercase tracking-wider">
                  🇳🇬 NaijaPages Verified
                </span>
                <h4 className="font-black text-lg text-white mt-0.5">{business.name}</h4>
                <p className="text-xs text-emerald-200 font-medium">{business.category}</p>
              </div>

              <div className="flex items-center gap-1 bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded text-xs font-bold border border-amber-400/30">
                <Star className="w-3.5 h-3.5 fill-current" />
                <span>{business.rating.toFixed(1)}</span>
              </div>
            </div>

            <div className="space-y-1 text-xs text-slate-300 pt-1 border-t border-emerald-800/60">
              <p className="flex items-center gap-1.5 truncate">
                <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>{business.address}, {business.state}</span>
              </p>
              {business.phone && (
                <p className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>{business.phone}</span>
                </p>
              )}
            </div>
          </div>

          {/* Share Actions */}
          <div className="space-y-2 pt-1">
            <button
              onClick={handleCopy}
              className="w-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 border border-slate-200 dark:border-slate-700 transition cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span className="text-emerald-600">Copied to Clipboard!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-slate-500" />
                  <span>Copy Business Details & Link</span>
                </>
              )}
            </button>

            <a
              href={whatsappShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full bg-[#25D366] hover:bg-[#20ba59] text-white font-bold text-xs py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition cursor-pointer shadow-xs"
            >
              <MessageCircle className="w-4 h-4 fill-current" />
              <span>Share to WhatsApp Contacts / Groups</span>
            </a>

            <a
              href={twitterShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full bg-slate-900 hover:bg-black text-white font-bold text-xs py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <Globe className="w-4 h-4" />
              <span>Share on X (Twitter)</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ShareBusinessModal: React.FC<ShareBusinessModalProps> = (props) =>
  props.isOpen && props.business ? <ShareBusiness {...props} business={props.business} /> : null;
