import React from 'react';
import { Search, MapPin, X, CheckCircle2, MessageCircle, Star, SlidersHorizontal, RotateCcw } from 'lucide-react';
import { CATEGORIES, STATES_DATA } from '../data/nigeriaData';
import { StateInfo } from '../types';

interface HeroSearchProps {
  searchTerm: string;
  onSearchChange: (val: string) => void;
  selectedState: string;
  onStateChange: (state: string) => void;
  selectedLga: string;
  onLgaChange: (lga: string) => void;
  selectedCategory: string;
  onCategoryChange: (cat: string) => void;
  verifiedOnly: boolean;
  onToggleVerifiedOnly: () => void;
  whatsappOnly: boolean;
  onToggleWhatsappOnly: () => void;
  highRatedOnly: boolean;
  onToggleHighRatedOnly: () => void;
  onResetFilters: () => void;
  totalFiltered: number;
  totalAll: number;
}

export const HeroSearch: React.FC<HeroSearchProps> = ({
  searchTerm,
  onSearchChange,
  selectedState,
  onStateChange,
  selectedLga,
  onLgaChange,
  selectedCategory,
  onCategoryChange,
  verifiedOnly,
  onToggleVerifiedOnly,
  whatsappOnly,
  onToggleWhatsappOnly,
  highRatedOnly,
  onToggleHighRatedOnly,
  onResetFilters,
  totalFiltered,
  totalAll,
}) => {
  const currentStateObj = STATES_DATA.find(s => s.name.toLowerCase() === selectedState.toLowerCase());
  const availableLgas = currentStateObj ? currentStateObj.lgas : [];

  const hasActiveFilters = Boolean(
    searchTerm || selectedState || selectedLga || (selectedCategory && selectedCategory !== 'All') || verifiedOnly || whatsappOnly || highRatedOnly
  );

  return (
    <div className="relative bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-900 text-white pt-10 pb-12 px-4 sm:px-6 lg:px-8 border-b border-emerald-800 shadow-lg">
      {/* Subtle decorative background pattern */}
      <div className="absolute inset-0 opacity-10 pointer-events-none overflow-hidden">
        <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <pattern id="grid" width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M 8 0 L 0 0 0 8" fill="none" stroke="currentColor" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      <div className="relative max-w-5xl mx-auto text-center space-y-6">
        {/* Main Heading */}
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 bg-emerald-800/80 border border-emerald-600/50 px-3 py-1 rounded-full text-xs font-semibold text-emerald-200">
            <span>🇳🇬 Nigeria's National Business Directory</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            <span>36 States + FCT</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white drop-shadow-sm">
            Find & Connect With Any <span className="text-emerald-300">Nigerian Business</span>
          </h1>
          <p className="text-sm sm:text-base text-emerald-100/90 max-w-2xl mx-auto font-normal">
            Direct WhatsApp inquiries, verified phone lines, physical addresses, and interactive Google Maps across all states and local government areas.
          </p>
        </div>

        {/* Search Bar Container */}
        <div className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 p-2 sm:p-2.5 rounded-2xl shadow-2xl border border-emerald-500/30 flex flex-col md:flex-row gap-2">
          {/* Text Search Input */}
          <div className="relative flex-1 flex items-center min-w-0">
            <Search className="w-5 h-5 text-emerald-600 ml-3 shrink-0" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search by company name, service, bank, doctor, hotel..."
              className="w-full px-3 py-3 text-sm bg-transparent outline-none placeholder:text-slate-400 font-medium"
            />
            {searchTerm && (
              <button
                onClick={() => onSearchChange('')}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 mr-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* State Selector */}
          <div className="relative md:w-52 flex items-center border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 pt-2 md:pt-0 pl-0 md:pl-2">
            <MapPin className="w-4 h-4 text-emerald-600 ml-2 shrink-0" />
            <select
              value={selectedState}
              onChange={(e) => {
                onStateChange(e.target.value);
                onLgaChange('');
              }}
              className="w-full bg-transparent px-2.5 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 outline-none cursor-pointer appearance-none truncate pr-6"
            >
              <option value="" className="text-slate-900 dark:text-slate-100">All Nigeria (36 States + FCT)</option>
              {STATES_DATA.map((state) => (
                <option key={state.key} value={state.name} className="text-slate-900 dark:text-slate-100">
                  {state.name} ({state.capital})
                </option>
              ))}
            </select>
          </div>

          {/* Dynamic LGA Selector (shown if state selected) */}
          {selectedState && availableLgas.length > 0 && (
            <div className="relative md:w-48 flex items-center border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 pt-2 md:pt-0 pl-0 md:pl-2">
              <select
                value={selectedLga}
                onChange={(e) => onLgaChange(e.target.value)}
                className="w-full bg-transparent px-2 py-3 text-xs font-semibold text-slate-700 dark:text-slate-200 outline-none cursor-pointer appearance-none truncate"
              >
                <option value="" className="text-slate-900 dark:text-slate-100">All LGAs in {selectedState}</option>
                {availableLgas.map((lga) => (
                  <option key={lga} value={lga} className="text-slate-900 dark:text-slate-100">
                    {lga}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Search Trigger */}
          <button
            onClick={() => {}}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm px-6 py-3 rounded-xl shadow transition-colors flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            <Search className="w-4 h-4" />
            <span>Search</span>
          </button>
        </div>

        {/* Quick Hub Filter Chips */}
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
          <span className="text-emerald-300 font-semibold">Popular Commercial Hubs:</span>
          <button
            onClick={() => {
              onStateChange('Rivers');
              onLgaChange('');
              onSearchChange('');
            }}
            className={`px-3 py-1 rounded-full border transition cursor-pointer font-bold ${
              selectedState === 'Rivers' || searchTerm.toLowerCase().includes('port harcourt')
                ? 'bg-amber-400 text-slate-900 border-amber-300 shadow-sm'
                : 'bg-emerald-950/60 hover:bg-emerald-800 border-emerald-600/60 text-emerald-100'
            }`}
          >
            📍 Port Harcourt (Rivers)
          </button>

          <button
            onClick={() => {
              onStateChange('Kogi');
              onLgaChange('');
              onSearchChange('');
            }}
            className={`px-3 py-1 rounded-full border transition cursor-pointer font-bold ${
              selectedState === 'Kogi'
                ? 'bg-amber-400 text-slate-900 border-amber-300 shadow-sm'
                : 'bg-emerald-950/60 hover:bg-emerald-800 border-emerald-600/60 text-emerald-100'
            }`}
          >
            📍 Kogi State
          </button>

          <button
            onClick={() => {
              onStateChange('Lagos');
              onLgaChange('');
              onSearchChange('');
            }}
            className={`px-3 py-1 rounded-full border transition cursor-pointer font-bold ${
              selectedState === 'Lagos'
                ? 'bg-amber-400 text-slate-900 border-amber-300 shadow-sm'
                : 'bg-emerald-950/60 hover:bg-emerald-800 border-emerald-600/60 text-emerald-100'
            }`}
          >
            📍 Lagos
          </button>

          <button
            onClick={() => {
              onStateChange('FCT');
              onLgaChange('');
              onSearchChange('');
            }}
            className={`px-3 py-1 rounded-full border transition cursor-pointer font-bold ${
              selectedState === 'FCT'
                ? 'bg-amber-400 text-slate-900 border-amber-300 shadow-sm'
                : 'bg-emerald-950/60 hover:bg-emerald-800 border-emerald-600/60 text-emerald-100'
            }`}
          >
            📍 Abuja FCT
          </button>

          <button
            onClick={() => {
              onStateChange('Oyo');
              onLgaChange('');
              onSearchChange('');
            }}
            className={`px-3 py-1 rounded-full border transition cursor-pointer font-bold ${
              selectedState === 'Oyo' || searchTerm.toLowerCase().includes('ibadan') || searchTerm.toLowerCase().includes('oyo')
                ? 'bg-amber-400 text-slate-900 border-amber-300 shadow-sm'
                : 'bg-emerald-950/60 hover:bg-emerald-800 border-emerald-600/60 text-emerald-100'
            }`}
          >
            📍 Oyo (Ibadan)
          </button>

          <button
            onClick={() => {
              onStateChange('Kano');
              onLgaChange('');
              onSearchChange('');
            }}
            className={`px-3 py-1 rounded-full border transition cursor-pointer font-bold ${
              selectedState === 'Kano' || searchTerm.toLowerCase().includes('kano')
                ? 'bg-amber-400 text-slate-900 border-amber-300 shadow-sm'
                : 'bg-emerald-950/60 hover:bg-emerald-800 border-emerald-600/60 text-emerald-100'
            }`}
          >
            📍 Kano (Centre of Commerce)
          </button>
        </div>

        {/* Category Filter Chips */}
        <div className="pt-2">
          <div className="flex items-center justify-center gap-2 overflow-x-auto pb-2 scrollbar-none max-w-full">
            {CATEGORIES.map((cat) => {
              const isSelected = selectedCategory === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => onCategoryChange(cat.key)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer border ${
                    isSelected
                      ? 'bg-white text-emerald-950 border-white shadow-md font-extrabold scale-105'
                      : 'bg-emerald-900/60 hover:bg-emerald-800/80 text-emerald-100 border-emerald-700/60'
                  }`}
                >
                  <span>{cat.emoji}</span>
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick Toggles Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-emerald-100/90 border-t border-emerald-800/60">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-emerald-300 flex items-center gap-1">
              <SlidersHorizontal className="w-3.5 h-3.5" /> Quick Filters:
            </span>

            <button
              onClick={onToggleVerifiedOnly}
              className={`px-3 py-1 rounded-full border transition-colors flex items-center gap-1 cursor-pointer font-medium ${
                verifiedOnly
                  ? 'bg-emerald-500 text-white border-emerald-400 font-bold'
                  : 'bg-emerald-900/40 border-emerald-700/60 hover:bg-emerald-800/60 text-emerald-100'
              }`}
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>Verified Only</span>
            </button>

            <button
              onClick={onToggleWhatsappOnly}
              className={`px-3 py-1 rounded-full border transition-colors flex items-center gap-1 cursor-pointer font-medium ${
                whatsappOnly
                  ? 'bg-green-500 text-white border-green-400 font-bold'
                  : 'bg-emerald-900/40 border-emerald-700/60 hover:bg-emerald-800/60 text-emerald-100'
              }`}
            >
              <MessageCircle className="w-3 h-3" />
              <span>WhatsApp Direct</span>
            </button>

            <button
              onClick={onToggleHighRatedOnly}
              className={`px-3 py-1 rounded-full border transition-colors flex items-center gap-1 cursor-pointer font-medium ${
                highRatedOnly
                  ? 'bg-amber-500 text-white border-amber-400 font-bold'
                  : 'bg-emerald-900/40 border-emerald-700/60 hover:bg-emerald-800/60 text-emerald-100'
              }`}
            >
              <Star className="w-3 h-3 fill-current text-amber-300" />
              <span>4.5+ Rating</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-semibold text-emerald-200">
              Showing <b className="text-white">{totalFiltered}</b> of {totalAll} businesses
            </span>

            {hasActiveFilters && (
              <button
                onClick={onResetFilters}
                className="inline-flex items-center gap-1 text-emerald-300 hover:text-white underline cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                Reset filters
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
