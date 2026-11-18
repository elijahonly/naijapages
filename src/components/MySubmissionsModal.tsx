import React, { useCallback, useEffect, useState } from 'react';
import { X, Building2, ShoppingBag, ShieldCheck, Trash2, Loader2, Clock, CheckCircle2, XCircle, Ban, AlertCircle, Plus, Inbox } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useModal } from '../hooks/useModal';
import { deleteMyAd, deleteMyBusiness, fetchMySubmissions, timeAgo, type MySubmissions } from '../services/content';
import { friendlyError, logError } from '../lib/errors';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onListBusiness: () => void;
  onPostAd: () => void;
}

type Tab = 'businesses' | 'ads' | 'claims';

const badge = (status?: string) => {
  switch (status) {
    case 'approved':
    case 'active':
      return { label: 'Live', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300', Icon: CheckCircle2 };
    case 'pending':
      return { label: 'Awaiting review', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300', Icon: Clock };
    case 'rejected':
      return { label: 'Not approved', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300', Icon: XCircle };
    case 'removed':
      return { label: 'Removed', cls: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300', Icon: Ban };
    default:
      return { label: status ?? 'Unknown', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', Icon: Clock };
  }
};

const MySubmissionsPanel: React.FC<Props> = ({ onClose, onListBusiness, onPostAd }) => {
  useModal(onClose);
  const { currentUser } = useAuth();
  const [tab, setTab] = useState<Tab>('businesses');
  const [data, setData] = useState<MySubmissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchMySubmissions(currentUser.uid));
    } catch (err) {
      logError('load submissions', err);
      setError(friendlyError(err, 'We could not load your submissions.'));
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (kind: 'business' | 'ad', id: string, title: string) => {
    if (!window.confirm(`Delete "${title}" permanently? This cannot be undone.`)) return;
    setBusyId(id);
    try {
      if (kind === 'business') await deleteMyBusiness(id);
      else await deleteMyAd(id);
      await load();
    } catch (err) {
      setError(friendlyError(err, 'We could not delete that. Please try again.'));
    } finally {
      setBusyId(null);
    }
  };

  const counts = { businesses: data?.businesses.length ?? 0, ads: data?.ads.length ?? 0, claims: data?.claims.length ?? 0 };
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'businesses', label: 'Businesses', icon: <Building2 size={14} /> },
    { id: 'ads', label: 'Ads', icon: <ShoppingBag size={14} /> },
    { id: 'claims', label: 'Claims', icon: <ShieldCheck size={14} /> },
  ];

  const empty = (text: string, cta?: { label: string; onClick: () => void }) => (
    <div className="text-center py-10 px-4">
      <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mb-3"><Inbox size={22} /></div>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">{text}</p>
      {cta && (
        <button onClick={() => { onClose(); cta.onClick(); }} className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl">
          <Plus size={14} /> {cta.label}
        </button>
      )}
    </div>
  );

  const Row: React.FC<{ title: string; sub: string; status?: string; note?: string; createdAt?: number; onDelete?: () => void; id: string }> = ({ title, sub, status, note, createdAt, onDelete, id }) => {
    const b = badge(status);
    return (
      <li className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold text-sm text-slate-900 dark:text-white truncate">{title}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{sub}{createdAt ? ` · submitted ${timeAgo(createdAt)}` : ''}</p>
          </div>
          <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold ${b.cls}`}>
            <b.Icon size={11} /> {b.label}
          </span>
        </div>
        {note && (status === 'rejected' || status === 'removed') && (
          <p className="mt-2 text-[11px] bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/50 text-rose-800 dark:text-rose-300 rounded-lg p-2">
            <b>Note from our team:</b> {note}
          </p>
        )}
        {onDelete && (
          <div className="mt-2.5 flex justify-end">
            <button onClick={onDelete} disabled={busyId === id} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-rose-600 disabled:opacity-50">
              {busyId === id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="mysub-title" className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 w-full max-w-2xl max-h-[88vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-emerald-800 to-teal-800 text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div>
            <h2 id="mysub-title" className="font-extrabold text-lg">My Submissions</h2>
            <p className="text-xs text-emerald-100">Track your listings, ads and ownership claims.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 text-white/80 hover:text-white rounded-lg hover:bg-white/10"><X size={20} /></button>
        </div>

        <div className="flex gap-1 px-4 pt-3 shrink-0">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition ${tab === t.id ? 'bg-emerald-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'}`}>
              {t.icon} {t.label}
              <span className={`px-1.5 rounded-full text-[10px] ${tab === t.id ? 'bg-white/25' : 'bg-slate-200 dark:bg-slate-800'}`}>{counts[t.id]}</span>
            </button>
          ))}
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {error && (
            <div role="alert" className="mb-3 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle size={15} className="shrink-0 mt-0.5" /> <span>{error}</span>
            </div>
          )}
          {loading ? (
            <div className="py-12 flex justify-center text-emerald-600"><Loader2 className="animate-spin" /></div>
          ) : !data ? null : tab === 'businesses' ? (
            data.businesses.length === 0 ? empty('You haven’t listed a business yet.', { label: 'List your business', onClick: onListBusiness }) : (
              <ul className="space-y-2.5">
                {data.businesses.map((b) => (
                  <Row key={b.id} id={b.id} title={b.name} sub={`${b.category} · ${b.lga}, ${b.state}${b.isVerified ? ' · Verified' : ''}`} status={b.status} note={b.moderationNote} createdAt={b.createdAt} onDelete={() => remove('business', b.id, b.name)} />
                ))}
              </ul>
            )
          ) : tab === 'ads' ? (
            data.ads.length === 0 ? empty('You haven’t posted any ads yet.', { label: 'Post an ad', onClick: onPostAd }) : (
              <ul className="space-y-2.5">
                {data.ads.map((a) => (
                  <Row key={a.id} id={a.id} title={a.title} sub={`₦${a.price.toLocaleString()} · ${a.lga}, ${a.state}`} status={a.status} note={a.moderationNote} createdAt={a.createdAt} onDelete={() => remove('ad', a.id, a.title)} />
                ))}
              </ul>
            )
          ) : data.claims.length === 0 ? empty('No ownership claims yet. Open any business and choose “Claim this listing”.') : (
            <ul className="space-y-2.5">
              {data.claims.map((c) => (
                <Row key={c.id} id={c.id} title={c.businessName} sub={c.role} status={c.status === 'approved' ? 'approved' : c.status} note={c.reviewNote} createdAt={c.createdAt} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export const MySubmissionsModal: React.FC<Props> = (props) => (props.isOpen ? <MySubmissionsPanel {...props} /> : null);
