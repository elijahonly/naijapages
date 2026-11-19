import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  ClipboardCopy,
  Flag,
  History,
  LayoutDashboard,
  Loader2,
  LogOut,
  Mail,
  Menu,
  Moon,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Star,
  Sun,
  UserCog,
  Users as UsersIcon,
  ExternalLink,
  Lock,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { authErrorMessage } from '../lib/errors';
import { cleanEmail } from '../lib/security';
import { navigate } from '../lib/router';
import { AdminCtx, AdminOverview, fetchAdminOverview, useAdminQuery } from './api';
import { AdminContext, AdminContextValue } from './AdminContext';
import { Btn, Card, ConfirmProvider, ErrorNote, ToastProvider, useToast, inputCls } from './ui';

import Dashboard from './pages/Dashboard';
import Businesses from './pages/Businesses';
import Marketplace from './pages/Marketplace';
import Reports from './pages/Reports';
import Claims from './pages/Claims';
import Users from './pages/Users';
import Reviews from './pages/Reviews';
import Messages from './pages/Messages';
import SettingsPage from './pages/Settings';
import Activity from './pages/Activity';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'businesses', label: 'Businesses', icon: Building2, badge: 'pendingBusinesses' },
  { id: 'marketplace', label: 'Marketplace', icon: ShoppingBag, badge: 'pendingAds' },
  { id: 'reports', label: 'Reports', icon: Flag, badge: 'openReports' },
  { id: 'claims', label: 'Ownership claims', icon: ShieldCheck, badge: 'pendingClaims' },
  { id: 'users', label: 'Users & admins', icon: UsersIcon },
  { id: 'reviews', label: 'Reviews', icon: Star },
  { id: 'messages', label: 'Messages & newsletter', icon: Mail, badge: 'newMessageCount' },
  { id: 'settings', label: 'Site settings', icon: SettingsIcon },
  { id: 'activity', label: 'Activity log', icon: History },
] as const;

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

const Shell: React.FC<{ section: string; admin: AdminCtx; displayName: string }> = ({ section, admin, displayName }) => {
  const { logout } = useAuth();
  const [isDark, setIsDark] = useLocalStorage<boolean>('naijapages_theme_dark', false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  useEffect(() => {
    document.title = 'Admin | NaijaPages';
    window.scrollTo({ top: 0 });
    setNavOpen(false);
  }, [section]);

  const INITIAL_OVERVIEW: AdminOverview = {
    stats: { users: 0, businesses: 0, ads: 0, reviews: 0, subscribers: 0 },
    queues: {
      pendingBusinesses: [],
      pendingAds: [],
      openReports: [],
      pendingClaims: [],
      newMessageCount: 0,
      overrides: [],
    },
    recentAudit: [],
  };

  // Live D1 queues of things waiting for a decision (also feed the sidebar badges).
  const overview = useAdminQuery(fetchAdminOverview, INITIAL_OVERVIEW, []);

  const ctx = useMemo<AdminContextValue>(
    () => ({
      admin,
      pendingBusinesses: overview.data.queues.pendingBusinesses,
      pendingAds: overview.data.queues.pendingAds,
      openReports: overview.data.queues.openReports,
      pendingClaims: overview.data.queues.pendingClaims,
      newMessageCount: overview.data.queues.newMessageCount,
      overrides: overview.data.queues.overrides,
    }),
    [admin, overview.data.queues],
  );

  const badgeCount = (key?: string): number => {
    if (!key) return 0;
    const v = ctx[key as keyof AdminContextValue];
    return Array.isArray(v) ? v.length : typeof v === 'number' ? v : 0;
  };

  const knownSection = NAV.some((n) => n.id === section);
  const activeId = knownSection ? section : 'dashboard';

  const page = (() => {
    switch (activeId) {
      case 'businesses':
        return <Businesses />;
      case 'marketplace':
        return <Marketplace />;
      case 'reports':
        return <Reports />;
      case 'claims':
        return <Claims />;
      case 'users':
        return <Users />;
      case 'reviews':
        return <Reviews />;
      case 'messages':
        return <Messages />;
      case 'settings':
        return <SettingsPage />;
      case 'activity':
        return <Activity />;
      default:
        return <Dashboard />;
    }
  })();

  const sidebar = (
    <nav aria-label="Admin sections" className="flex flex-col h-full">
      <div className="px-5 py-5 flex items-center gap-2.5 border-b border-white/10">
        <div className="w-9 h-9 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center font-black">🇳🇬</div>
        <div>
          <p className="font-extrabold text-white leading-tight">NaijaPages</p>
          <p className="text-[10px] uppercase tracking-widest text-emerald-300 font-bold">Admin console</p>
        </div>
      </div>

      <ul className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV.map((item) => {
          const active = activeId === item.id;
          const count = badgeCount('badge' in item ? item.badge : undefined);
          return (
            <li key={item.id}>
              <a
                href={`#/admin/${item.id === 'dashboard' ? '' : item.id}`}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition ${
                  active ? 'bg-emerald-600 text-white shadow' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <item.icon size={17} />
                <span className="flex-1">{item.label}</span>
                {count > 0 && (
                  <span className="min-w-5 text-center px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-400 text-slate-950">{count >= 100 ? '99+' : count}</span>
                )}
              </a>
            </li>
          );
        })}
      </ul>

      <div className="px-3 py-4 border-t border-white/10 space-y-1">
        <a href="#/" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-300 hover:bg-white/10 hover:text-white">
          <ExternalLink size={17} /> View public site
        </a>
        <button
          type="button"
          onClick={async () => {
            await logout();
          }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer"
        >
          <LogOut size={17} /> Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <AdminContext.Provider value={ctx}>
      <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex font-sans">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block w-64 shrink-0 bg-slate-900 sticky top-0 h-screen">{sidebar}</aside>

        {/* Mobile drawer */}
        {navOpen && (
          <div className="lg:hidden fixed inset-0 z-[70] flex">
            <div className="w-72 max-w-[85%] bg-slate-900 h-full shadow-2xl">{sidebar}</div>
            <button type="button" aria-label="Close menu" className="flex-1 bg-black/50" onClick={() => setNavOpen(false)} />
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="sticky top-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setNavOpen(true)} aria-label="Open menu" className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <Menu size={20} />
              </button>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-950 px-2.5 py-1 rounded-full">
                <UserCog size={12} /> Administrator
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsDark((v) => !v)}
                aria-label="Toggle dark mode"
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                {isDark ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} className="text-slate-600" />}
              </button>
              <div className="hidden sm:block text-right leading-tight">
                <p className="text-xs font-bold text-slate-800 dark:text-slate-100 max-w-[180px] truncate">{displayName}</p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 max-w-[180px] truncate">{admin.email}</p>
              </div>
            </div>
          </header>

          <main className="flex-1 p-4 sm:p-6 w-full max-w-6xl mx-auto">{page}</main>
        </div>
      </div>
    </AdminContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// Gate: sign in → must be an admin
// ---------------------------------------------------------------------------

const GateShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 flex items-center justify-center p-4 font-sans">
    <div className="w-full max-w-md">{children}</div>
  </div>
);

const SignInCard: React.FC = () => {
  const { signInWithEmail, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const clean = cleanEmail(email);
    if (!clean || !password) return setError('Enter your email address and password.');
    setBusy(true);
    try {
      await signInWithEmail(clean, password);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateShell>
      <Card className="p-7">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center"><Lock size={20} /></div>
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-white">Admin sign in</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">NaijaPages administrators only</p>
          </div>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Btn
          variant="outline"
          size="md"
          className="w-full"
          disabled={busy}
          onClick={async () => {
            setError(null);
            try {
              await signInWithGoogle();
            } catch (err) {
              setError(authErrorMessage(err));
            }
          }}
        >
          Continue with Google
        </Btn>
        <div className="my-4 text-center text-[11px] uppercase text-slate-400 font-semibold">or</div>
        <form onSubmit={submit} className="space-y-3" noValidate>
          <input type="email" autoComplete="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} aria-label="Email address" />
          <input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} aria-label="Password" />
          <Btn type="submit" variant="primary" size="md" className="w-full" loading={busy}>Sign in</Btn>
        </form>
        <a href="#/" className="block text-center mt-5 text-xs font-semibold text-slate-500 hover:text-emerald-600">← Back to NaijaPages</a>
      </Card>
    </GateShell>
  );
};

const NotAdminCard: React.FC = () => {
  const { currentUser, ban, logout, refreshRoles } = useAuth();
  const toast = useToast();
  const [checking, setChecking] = useState(false);
  const uid = currentUser?.uid ?? '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(uid);
      toast.success('User ID copied');
    } catch {
      toast.error('Could not copy. Select the ID and copy it manually.');
    }
  };

  return (
    <GateShell>
      <Card className="p-7">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-xl bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 flex items-center justify-center"><ShieldAlert size={22} /></div>
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-white">This account isn’t an admin</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 break-all">Signed in as {currentUser?.email}</p>
          </div>
        </div>

        {ban ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">This account is suspended and can’t be used as an administrator.</p>
        ) : (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
              Admin access is controlled server-side in Cloudflare D1. To grant this account the initial admin role:
            </p>
            <ol className="text-[13px] text-slate-700 dark:text-slate-300 space-y-2 list-decimal pl-5 mb-4">
              <li>
                Set <code className="px-1 rounded bg-slate-100 dark:bg-slate-800 text-[12px]">BOOTSTRAP_ADMIN_EMAIL</code> in Worker secrets before verifying your account, or promote this user ID in D1:
              </li>
            </ol>
            <div className="flex items-center gap-2 mb-4">
              <code className="flex-1 text-[12px] bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2 break-all select-all">{uid}</code>
              <Btn onClick={copy} icon={<ClipboardCopy size={13} />}>Copy</Btn>
            </div>
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-5">
              Example: <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">UPDATE user SET role = 'admin' WHERE id = '{uid}';</code> then press <b>Check again</b>.
            </p>
          </>
        )}

        <div className="flex flex-wrap gap-2">
          {!ban && (
            <Btn
              variant="primary"
              size="md"
              loading={checking}
              onClick={async () => {
                setChecking(true);
                await refreshRoles();
                setChecking(false);
              }}
            >
              Check again
            </Btn>
          )}
          <Btn size="md" onClick={() => logout()} icon={<LogOut size={14} />}>Sign out</Btn>
          <Btn size="md" variant="ghost" onClick={() => navigate('/')}>Back to site</Btn>
        </div>
      </Card>
    </GateShell>
  );
};

const Gate: React.FC<{ section: string }> = ({ section }) => {
  const { currentUser, userProfile, loading, isAdmin, ban } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950 text-emerald-600">
        <Loader2 className="w-8 h-8 animate-spin" aria-label="Loading" />
      </div>
    );
  }
  if (!currentUser) return <SignInCard />;
  if (!isAdmin || ban) return <NotAdminCard />;

  return (
    <Shell
      section={section}
      admin={{ uid: currentUser.uid, email: currentUser.email ?? '' }}
      displayName={userProfile?.displayName || currentUser.displayName || 'Administrator'}
    />
  );
};

export default function AdminApp({ section }: { section: string }) {
  // Keep the admin area out of search engines (it's also a hash route, so crawlers rarely see it).
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);

  return (
    <ToastProvider>
      <ConfirmProvider>
        <Gate section={section} />
      </ConfirmProvider>
    </ToastProvider>
  );
}
