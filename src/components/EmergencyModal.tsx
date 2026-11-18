import React from 'react';
import { useModal } from '../hooks/useModal';
import { X, PhoneCall, AlertTriangle, Shield, Flame, Ambulance } from 'lucide-react';
import { EMERGENCY_CONTACTS, formatTelUrl } from '../data/nigeriaData';

interface EmergencyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const EmergencyPanel: React.FC<Pick<EmergencyModalProps, 'onClose'>> = ({ onClose }) => {
  useModal(onClose);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden my-6 flex flex-col"
        role="dialog" aria-modal="true" aria-label="Emergency hotlines"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-red-700 via-rose-700 to-amber-700 text-white p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <PhoneCall className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <h2 className="font-extrabold text-lg sm:text-xl">Nigeria Emergency Hotlines</h2>
              <p className="text-xs text-red-100">
                Direct toll-free lines for immediate medical, fire, security & highway assistance.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-white/80 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-3.5 max-h-[75vh]">
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/40 rounded-xl text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              If you or someone around you is in immediate danger, dial <b>112</b> from any mobile phone (MTN, Airtel, Glo, 9mobile) without airtime.
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {EMERGENCY_CONTACTS.map((item, idx) => (
              <div
                key={idx}
                className="p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/80 flex flex-col justify-between gap-3 hover:border-red-400 dark:hover:border-red-500 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-950/80 px-2 py-0.5 rounded">
                      {item.coverage}
                    </span>
                    <span className="text-[10px] text-slate-400 truncate">{item.agency}</span>
                  </div>

                  <h3 className="font-bold text-sm text-slate-900 dark:text-white mt-1.5">
                    {item.service}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-normal">
                    {item.description}
                  </p>
                </div>

                <a
                  href={formatTelUrl(item.number)}
                  className="bg-red-600 hover:bg-red-700 text-white font-extrabold text-sm py-2 px-3 rounded-lg text-center flex items-center justify-center gap-2 shadow-xs transition cursor-pointer"
                >
                  <PhoneCall className="w-4 h-4" />
                  <span>Call {item.number}</span>
                </a>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 bg-slate-50 dark:bg-slate-800/30 border-t border-slate-200 dark:border-slate-800 text-right">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-lg transition cursor-pointer"
          >
            Close Emergency List
          </button>
        </div>
      </div>
    </div>
  );
};

export const EmergencyModal: React.FC<EmergencyModalProps> = ({ isOpen, onClose }) =>
  isOpen ? <EmergencyPanel onClose={onClose} /> : null;
