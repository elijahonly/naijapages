import React, { useState, useRef, useEffect } from 'react';
import { 
  Building2, 
  Plus, 
  Bookmark, 
  PhoneCall, 
  Moon, 
  Sun, 
  MapPin, 
  ShieldCheck, 
  Compass,
  LogIn,
  LogOut,
  User as UserIcon,
  ChevronDown,
  ShoppingBag,
  Store,
  ClipboardList,
  LayoutDashboard,
  Info,
  Mail
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { navigate } from '../lib/router';

interface HeaderProps {
  /** Which main tab is highlighted. `null` on standalone pages such as About / Contact. */
  activeMainTab: 'directory' | 'marketplace' | null;
  /** Standalone page currently shown, for nav highlighting. */
  activePage?: 'about' | 'contact' | null;
  onChangeMainTab: (tab: 'directory' | 'marketplace') => void;
  onAddBusiness: () => void;
  onOpenPostAd: () => void;
  onOpenMySubmissions: () => void;
  onOpenEmergency: () => void;
  onOpenStateExplorer: () => void;
  onToggleBookmarksOnly: () => void;
  showingBookmarksOnly: boolean;
  bookmarkedCount: number;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  totalListings: number;
  marketplaceItemsCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeMainTab,
  activePage = null,
  onChangeMainTab,
  onAddBusiness,
  onOpenPostAd,
  onOpenMySubmissions,
  onOpenEmergency,
  onOpenStateExplorer,
  onToggleBookmarksOnly,
  showingBookmarksOnly,
  bookmarkedCount,
  isDarkMode,
  onToggleDarkMode,
  totalListings,
  marketplaceItemsCount,
}) => {
  const { currentUser, userProfile, logout, openAuthModal, isAdmin, emailVerified } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getInitials = (name?: string | null, email?: string | null) => {
    if (name) {
      const parts = name.trim().split(' ');
      if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      return name.slice(0, 2).toUpperCase();
    }
    if (email) return email.slice(0, 2).toUpperCase();
    return 'NP';
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors">
      {/* Top Banner Notice */}
      <div className="bg-emerald-800 text-white text-xs px-4 py-1.5 flex items-center justify-between overflow-x-auto whitespace-nowrap">
        <div className="flex items-center gap-2 mx-auto">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>Verified Nigerian Business Directory across all 36 States & FCT</span>
          <span className="hidden md:inline text-emerald-200">•</span>
          <span className="hidden md:inline text-emerald-200">Direct WhatsApp & Call connectivity</span>
          <span className="hidden md:inline text-emerald-200">•</span>
          <span className="hidden md:inline font-semibold">{totalListings} Active Businesses Listed</span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-2">
          <nav aria-label="Company" className="hidden sm:flex items-center gap-3 text-emerald-100">
            {([
              ['about', 'About us'],
              ['contact', 'Contact us'],
            ] as const).map(([page, label]) => (
              <a
                key={page}
                href={`#/${page}`}
                aria-current={activePage === page ? 'page' : undefined}
                className={`font-semibold hover:text-white transition-colors ${activePage === page ? 'text-white underline underline-offset-4' : ''}`}
              >
                {label}
              </a>
            ))}
          </nav>
          <button
            onClick={onOpenEmergency}
            className="text-xs bg-red-600 hover:bg-red-700 text-white font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1 transition-colors cursor-pointer shrink-0"
            title="Emergency lines across Nigeria (112, 767, FRSC, Police)"
          >
            <PhoneCall className="w-3 h-3 animate-bounce" />
            <span>Emergency Hotlines</span>
          </button>
        </div>
      </div>

      {/* Main Navbar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-16 py-2 sm:py-0 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-3 gap-y-2">
        {/* Brand Logo */}
        <div className="flex items-center gap-3">
          <a href="#/" className="flex items-center gap-2 group" aria-label="NaijaPages home">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-700 to-emerald-500 text-white flex items-center justify-center font-black text-xl shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform">
              <span className="text-white text-lg">🇳🇬</span>
            </div>
            <div>
              <div className="flex items-center gap-1">
                <span className="font-extrabold text-xl text-slate-900 dark:text-white tracking-tight">
                  Naija<span className="text-emerald-600 dark:text-emerald-400">Pages</span>
                </span>
                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded">
                  <ShieldCheck className="w-3 h-3" />
                  Verified
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium -mt-1 hidden sm:block">
                Nigeria Business Directory & Marketplace
              </p>
            </div>
          </a>

          {/* Directory vs Marketplace Navigation Switcher */}
          <div className="hidden lg:flex items-center bg-slate-100 dark:bg-slate-800/90 p-1 rounded-xl border border-slate-200 dark:border-slate-700 ml-4">
            <button
              onClick={() => onChangeMainTab('directory')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeMainTab === 'directory'
                  ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Directory</span>
            </button>

            <button
              onClick={() => onChangeMainTab('marketplace')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeMainTab === 'marketplace'
                  ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5 text-amber-500" />
              <span>Marketplace</span>
              <span className="text-[9px] font-bold uppercase tracking-wider bg-amber-400 text-slate-950 px-1.5 py-0.2 rounded-full">
                Store
              </span>
            </button>
          </div>
        </div>

        {/* Center / Action Buttons */}
        <div className="flex flex-wrap sm:flex-nowrap items-center justify-between sm:justify-end gap-1.5 sm:gap-2.5 w-full sm:w-auto">
          {/* Mobile view switcher toggle */}
          <div className="flex lg:hidden items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => onChangeMainTab('directory')}
              className={`p-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                activeMainTab === 'directory'
                  ? 'bg-white dark:bg-slate-900 text-emerald-600'
                  : 'text-slate-500'
              }`}
              title="Directory"
            >
              <Building2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => onChangeMainTab('marketplace')}
              className={`p-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer relative ${
                activeMainTab === 'marketplace'
                  ? 'bg-white dark:bg-slate-900 text-emerald-600'
                  : 'text-slate-500'
              }`}
              title="Marketplace"
            >
              <ShoppingBag className="w-4 h-4 text-amber-500" />
            </button>
          </div>

          {/* 36 States Button */}
          <button
            onClick={onOpenStateExplorer}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-semibold rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
            title="Browse Nigeria's 36 States & FCT"
          >
            <Compass className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span className="hidden md:inline">36 States</span>
          </button>

          {/* Saved / Bookmarks Button */}
          <button
            onClick={onToggleBookmarksOnly}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-semibold rounded-lg border transition-colors cursor-pointer ${
              showingBookmarksOnly
                ? 'bg-amber-500 text-white border-amber-600'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700'
            }`}
            title="View saved businesses"
          >
            <Bookmark className={`w-4 h-4 ${showingBookmarksOnly ? 'fill-current' : 'text-amber-500'}`} />
            <span className="hidden lg:inline">Saved</span>
            {bookmarkedCount > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                showingBookmarksOnly ? 'bg-white text-amber-600' : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
              }`}>
                {bookmarkedCount}
              </span>
            )}
          </button>

          {/* Theme Toggle */}
          <button
            onClick={onToggleDarkMode}
            className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
            aria-label="Toggle dark mode"
          >
            {isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
          </button>

          {/* Post Ad CTA */}
          <button
            onClick={onOpenPostAd}
            className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm px-3 sm:px-3.5 py-2 rounded-lg shadow-sm hover:shadow transition cursor-pointer"
            title="Sell item / Post classified ad on Marketplace"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span className="hidden sm:inline">Sell /</span> Post Ad
          </button>

          {/* Add Business CTA */}
          <button
            onClick={onAddBusiness}
            className="hidden sm:flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm px-3 sm:px-3.5 py-2 rounded-lg shadow-sm hover:shadow transition cursor-pointer"
          >
            <Building2 className="w-4 h-4" />
            <span>List Business</span>
          </button>

          {/* User Authentication Status */}
          {currentUser ? (
            <div className="relative ml-auto sm:ml-0" ref={menuRef}>
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {currentUser.photoURL ? (
                  <img
                    src={currentUser.photoURL}
                    alt={currentUser.displayName || 'User'}
                    className="w-7 h-7 rounded-full object-cover ring-2 ring-emerald-500"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center">
                    {getInitials(currentUser.displayName, currentUser.email)}
                  </div>
                )}
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 hidden md:inline max-w-[100px] truncate">
                  {currentUser.displayName || currentUser.email?.split('@')[0]}
                </span>
                <ChevronDown size={14} className="text-slate-500" />
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 py-2 z-50 animate-fade-in">
                  <div className="px-3.5 py-2 border-b border-slate-100 dark:border-slate-800">
                    <p className="text-xs font-bold text-slate-800 dark:text-white truncate">
                      {currentUser.displayName || 'Naija Explorer'}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {currentUser.email}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded ${
                          emailVerified
                            ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60'
                            : 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60'
                        }`}
                      >
                        <ShieldCheck size={12} />
                        <span>{emailVerified ? 'Email verified' : 'Email not verified'}</span>
                      </span>
                      {isAdmin && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/60">
                          Admin
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="px-1.5 py-1">
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        onToggleBookmarksOnly();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-left"
                    >
                      <Bookmark size={14} className="text-amber-500" />
                      <span>My Bookmarked Businesses ({bookmarkedCount})</span>
                    </button>

                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        onOpenMySubmissions();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-left"
                    >
                      <ClipboardList size={14} className="text-emerald-600" />
                      <span>My Submissions</span>
                    </button>

                    {isAdmin && (
                      <button
                        onClick={() => {
                          setUserMenuOpen(false);
                          navigate('/admin');
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/40 rounded-lg transition-colors text-left"
                      >
                        <LayoutDashboard size={14} />
                        <span>Admin Dashboard</span>
                      </button>
                    )}

                    <a
                      href="#/about"
                      onClick={() => setUserMenuOpen(false)}
                      className="sm:hidden w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-left"
                    >
                      <Info size={14} className="text-slate-400" />
                      <span>About us</span>
                    </a>
                    <a
                      href="#/contact"
                      onClick={() => setUserMenuOpen(false)}
                      className="sm:hidden w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-left"
                    >
                      <Mail size={14} className="text-slate-400" />
                      <span>Contact us</span>
                    </a>

                    <button
                      onClick={async () => {
                        setUserMenuOpen(false);
                        await logout();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors text-left"
                    >
                      <LogOut size={14} />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => openAuthModal('signin')}
              className="ml-auto sm:ml-0 flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors shadow-sm cursor-pointer"
            >
              <LogIn className="w-4 h-4 text-emerald-400 dark:text-emerald-600" />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
