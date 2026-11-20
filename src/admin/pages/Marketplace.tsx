import React, { useMemo, useState } from 'react';
import { Ban, Check, ChevronDown, ExternalLink, RotateCcw, ShoppingBag, Trash2, BadgeCheck } from 'lucide-react';
import { MarketplaceItem } from '../../types';
import { approveAd, deleteAdForever, fetchAdminAds, removeAd, restoreAd, useAdminQuery } from '../api';
import { useAdmin } from '../AdminContext';
import { useRunner } from '../useRunner';
import { Badge, Btn, Card, EmptyState, ErrorNote, PageHeader, SearchBox, Spinner, Tabs, shortDate, statusTone, useConfirm } from '../ui';

type Tab = 'active' | 'pending' | 'removed' | 'all';

const naira = (n: number) => `₦${n.toLocaleString('en-NG')}`;

const AdRow: React.FC<{ a: MarketplaceItem; busy: string | null; run: ReturnType<typeof useRunner>['run'] }> = ({ a, busy, run }) => {
  const { admin } = useAdmin();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const isBusy = busy?.endsWith(`:${a.id}`) ?? false;

  const remove = async () => {
    const r = await confirm({
      title: `Remove “${a.title}”?`,
      message: 'The ad disappears from the Marketplace immediately. You can restore it later.',
      confirmLabel: 'Remove ad',
      tone: 'danger',
      reason: { label: 'Reason (shown to the seller)', placeholder: 'e.g. Prohibited item / suspected scam.', required: true },
    });
    if (r.ok) run(`remove:${a.id}`, () => removeAd(admin, a, r.reason), 'Ad removed');
  };
  const destroy = async () => {
    const r = await confirm({ title: `Delete “${a.title}” forever?`, message: 'This permanently erases the ad and cannot be undone.', confirmLabel: 'Delete forever', tone: 'danger' });
    if (r.ok) run(`delete:${a.id}`, () => deleteAdForever(admin, a), 'Ad deleted');
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="font-extrabold text-slate-900 dark:text-white break-words">{a.title}</h3>
            <Badge tone={statusTone(a.status)}>{a.status}</Badge>
            {a.isVerifiedSeller && <Badge tone="sky"><BadgeCheck size={11} /> Verified seller</Badge>}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            <b className="text-slate-700 dark:text-slate-200">{naira(a.price)}</b>{a.isNegotiable ? ' (negotiable)' : ''} · {a.category} · {a.condition} · {a.lga}, {a.state}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Seller: <b>{a.businessName}</b> · posted by {a.ownerName || 'Unknown'} · {shortDate(a.createdAt)}
          </p>
          {a.moderationNote && <p className="text-[11px] mt-1 text-rose-700 dark:text-rose-300">Note: {a.moderationNote}</p>}
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-xs font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 cursor-pointer">
          Details <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="mt-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 space-y-3 text-[13px] text-slate-700 dark:text-slate-200">
          <p className="whitespace-pre-line break-words">{a.description || 'No description.'}</p>
          <p className="text-xs text-slate-500">
            Phone: <b>{a.phone}</b>{a.whatsapp && a.whatsapp !== a.phone ? ` · WhatsApp: ${a.whatsapp}` : ''}{a.cacNumber ? ` · CAC (self-declared): ${a.cacNumber}` : ''}
          </p>
          <p className="text-xs text-slate-500">Poster account ID: <code>{a.ownerId}</code>{a.businessId ? <> · linked business: <code>{a.businessId}</code></> : null}</p>
          {showImage ? (
            <img src={a.imageUrl} alt="Ad preview" referrerPolicy="no-referrer" loading="lazy" className="max-h-56 rounded-lg border border-slate-200 dark:border-slate-700" />
          ) : (
            <div className="flex items-center gap-3">
              <Btn onClick={() => setShowImage(true)}>Load image preview</Btn>
              <span className="text-[11px] text-slate-400">Loads the picture from the seller’s image host.</span>
            </div>
          )}
          <a href={a.imageUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 hover:underline text-xs">
            Open image link <ExternalLink size={11} />
          </a>
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap gap-2">
        {a.status === 'pending' && (
          <Btn variant="primary" icon={<Check size={13} />} loading={busy === `approve:${a.id}`} disabled={isBusy} onClick={() => run(`approve:${a.id}`, () => approveAd(admin, a), 'Approved: now live')}>Approve</Btn>
        )}
        {a.status === 'removed' && (
          <Btn variant="primary" icon={<RotateCcw size={13} />} loading={busy === `restore:${a.id}`} disabled={isBusy} onClick={() => run(`restore:${a.id}`, () => restoreAd(admin, a), 'Ad restored')}>Restore</Btn>
        )}
        {(a.status === 'pending' || a.status === 'active') && <Btn variant="outline" icon={<Ban size={13} />} disabled={isBusy} onClick={remove}>Remove…</Btn>}
        {a.status === 'removed' && <Btn variant="danger" icon={<Trash2 size={13} />} disabled={isBusy} onClick={destroy}>Delete forever</Btn>}
      </div>
    </Card>
  );
};

export default function Marketplace() {
  const [tab, setTab] = useState<Tab>('active');
  const [term, setTerm] = useState('');
  const { busy, run } = useRunner();
  const { data, loading, error } = useAdminQuery(() => fetchAdminAds(), [], []);

  const counts = useMemo(() => {
    const c = { active: 0, pending: 0, removed: 0 };
    data.forEach((a) => {
      if (a.status && a.status in c) c[a.status as keyof typeof c] += 1;
    });
    return c;
  }, [data]);

  const q = term.trim().toLowerCase();
  const rows = useMemo(
    () =>
      data
        .filter((a) => tab === 'all' || a.status === tab)
        .filter((a) => !q || [a.title, a.businessName, a.category, a.state, a.lga, a.ownerName, a.phone, a.ownerId].some((v) => (v ?? '').toLowerCase().includes(q))),
    [data, tab, q],
  );

  return (
    <>
      <PageHeader
        title="Marketplace"
        subtitle="Ads from members go live straight away unless you switch on “ads need approval” in Site settings. Remove anything that breaks the rules."
        actions={<a href="#/admin/settings" className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline">Approval setting →</a>}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'active', label: 'Live', count: counts.active },
          { id: 'pending', label: 'Pending', count: counts.pending, alert: true },
          { id: 'removed', label: 'Removed', count: counts.removed },
          { id: 'all', label: 'All', count: data.length },
        ]}
      />

      <SearchBox value={term} onChange={setTerm} placeholder="Search title, seller, location or phone" className="mb-4 max-w-md" />
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<ShoppingBag size={22} />} title="No ads here" hint={tab === 'pending' ? 'Ads waiting for approval appear here when “ads need approval” is on.' : undefined} />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((a) => (
            <AdRow key={a.id} a={a} busy={busy} run={run} />
          ))}
        </div>
      )}
    </>
  );
}
