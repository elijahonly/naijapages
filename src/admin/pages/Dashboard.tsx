import React, { useEffect, useState } from 'react';
import { collection, limit, query, where } from 'firebase/firestore';
import { ArrowRight, Building2, Check, Flag, Mail, ShieldCheck, ShoppingBag, Star, Users, BadgeCheck, MailPlus } from 'lucide-react';
import { db } from '../../lib/firebase';
import { COL } from '../../lib/config';
import { approveBusiness, auditFromSnap, countOf, recent, useLive } from '../api';
import { useAdmin } from '../AdminContext';
import { useAuth } from '../../context/AuthContext';
import { useRunner } from '../useRunner';
import { Badge, Btn, Card, EmptyState, PageHeader, formatDate, shortDate } from '../ui';

const AttentionCard: React.FC<{ href: string; icon: React.ReactNode; label: string; count: number; hint: string }> = ({ href, icon, label, count, hint }) => (
  <a
    href={href}
    className={`group block rounded-2xl border p-4 transition shadow-sm hover:shadow-md ${
      count > 0
        ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800'
        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
    }`}
  >
    <div className="flex items-center justify-between">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${count > 0 ? 'bg-amber-400 text-slate-950' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>{icon}</div>
      <ArrowRight size={16} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
    </div>
    <p className="mt-3 text-3xl font-black text-slate-900 dark:text-white leading-none">{count >= 100 ? '99+' : count}</p>
    <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{label}</p>
    <p className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>
  </a>
);

const Stat: React.FC<{ icon: React.ReactNode; label: string; value: number | null }> = ({ icon, label, value }) => (
  <div className="flex items-center gap-3 p-4">
    <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">{icon}</div>
    <div>
      <p className="text-xl font-black text-slate-900 dark:text-white leading-none">{value === null ? '–' : value.toLocaleString()}</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{label}</p>
    </div>
  </div>
);

export default function Dashboard() {
  const { admin, pendingBusinesses, pendingAds, openReports, pendingClaims, newMessageCount } = useAdmin();
  const { userProfile } = useAuth();
  const { busy, run } = useRunner();
  const [stats, setStats] = useState<{ users: number; businesses: number; ads: number; reviews: number; subscribers: number } | null>(null);
  const activity = useLive(() => recent(COL.audit, 'createdAt', 6), auditFromSnap, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [users, businesses, ads, reviews, subscribers] = await Promise.all([
        countOf(collection(db, COL.users)),
        countOf(query(collection(db, COL.businesses), where('status', '==', 'approved'))),
        countOf(query(collection(db, COL.marketplace), where('status', '==', 'active'))),
        countOf(collection(db, COL.reviews)),
        countOf(collection(db, COL.subscribers)),
      ]);
      if (alive) setStats({ users, businesses, ads, reviews, subscribers });
    })();
    return () => {
      alive = false;
    };
  }, []);

  const today = new Intl.DateTimeFormat('en-NG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Lagos' }).format(new Date());
  const first = (userProfile?.displayName || '').split(' ')[0];
  const needsAttention = pendingBusinesses.length + pendingAds.length + openReports.length + pendingClaims.length + newMessageCount;

  return (
    <>
      <PageHeader
        title={`Welcome back${first ? `, ${first}` : ''} 👋`}
        subtitle={`${today} · ${needsAttention > 0 ? `${needsAttention} item${needsAttention === 1 ? '' : 's'} need your attention.` : 'Everything is up to date.'}`}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <AttentionCard href="#/admin/businesses" icon={<Building2 size={18} />} label="Businesses to review" count={pendingBusinesses.length} hint="New listings awaiting approval" />
        <AttentionCard href="#/admin/marketplace" icon={<ShoppingBag size={18} />} label="Ads to approve" count={pendingAds.length} hint="Only when approval is switched on" />
        <AttentionCard href="#/admin/reports" icon={<Flag size={18} />} label="Open reports" count={openReports.length} hint="Flagged by members" />
        <AttentionCard href="#/admin/claims" icon={<ShieldCheck size={18} />} label="Ownership claims" count={pendingClaims.length} hint="Verification requests" />
        <AttentionCard href="#/admin/messages" icon={<Mail size={18} />} label="New messages" count={newMessageCount} hint="From the Contact page" />
      </div>

      <Card className="mb-6 grid grid-cols-2 md:grid-cols-5 divide-x divide-y md:divide-y-0 divide-slate-100 dark:divide-slate-800">
        <Stat icon={<Users size={17} />} label="Registered members" value={stats?.users ?? null} />
        <Stat icon={<Building2 size={17} />} label="Live member listings" value={stats?.businesses ?? null} />
        <Stat icon={<ShoppingBag size={17} />} label="Live member ads" value={stats?.ads ?? null} />
        <Stat icon={<Star size={17} />} label="Reviews" value={stats?.reviews ?? null} />
        <Stat icon={<MailPlus size={17} />} label="Newsletter subscribers" value={stats?.subscribers ?? null} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-extrabold text-slate-900 dark:text-white">Waiting for approval</h2>
            <a href="#/admin/businesses" className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline">View all →</a>
          </div>
          {pendingBusinesses.length === 0 ? (
            <EmptyState icon={<Check size={22} />} title="Nothing waiting 🎉" hint="New business submissions will show up here." />
          ) : (
            <ul className="space-y-2">
              {pendingBusinesses.slice(0, 5).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{b.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{b.category} · {b.lga}, {b.state} · {shortDate(b.createdAt)}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Btn variant="primary" size="xs" icon={<Check size={12} />} loading={busy === `approve:${b.id}`} onClick={() => run(`approve:${b.id}`, () => approveBusiness(admin, b, false), 'Approved: now live')}>Approve</Btn>
                    <a href="#/admin/businesses" className="inline-flex items-center rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">Review</a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-extrabold text-slate-900 dark:text-white">Open reports</h2>
            <a href="#/admin/reports" className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline">View all →</a>
          </div>
          {openReports.length === 0 ? (
            <EmptyState icon={<BadgeCheck size={22} />} title="No open reports 🎉" hint="Reports from members will show up here." />
          ) : (
            <ul className="space-y-2">
              {openReports.slice(0, 5).map((r) => (
                <li key={r.id} className="p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge tone="red">{r.reason}</Badge>
                    <span className="text-[11px] text-slate-400">{shortDate(r.createdAt)}</span>
                  </div>
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate mt-1">{r.targetTitle}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-4 mt-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-extrabold text-slate-900 dark:text-white">Recent admin activity</h2>
          <a href="#/admin/activity" className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline">Full log →</a>
        </div>
        {activity.data.length === 0 ? (
          <p className="text-xs text-slate-500">No admin actions recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {activity.data.map((a) => (
              <li key={a.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span className="text-slate-700 dark:text-slate-200 min-w-0 truncate"><b>{a.adminEmail || 'An admin'}</b> · {a.summary || a.action}</span>
                <time className="text-[11px] text-slate-400">{formatDate(a.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
