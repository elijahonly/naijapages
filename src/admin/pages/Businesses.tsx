import React, { useDeferredValue, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  BadgeCheck,
  ChevronDown,
  Eye,
  EyeOff,
  ExternalLink,
  Pencil,
  RotateCcw,
  Trash2,
  X,
  Ban,
  ShieldOff,
} from 'lucide-react';
import { COL } from '../../lib/config';
import { INITIAL_BUSINESSES, CATEGORIES, STATES_DATA } from '../../data/nigeriaData';
import { Business } from '../../types';
import {
  BusinessEdit,
  approveBusiness,
  businessFromSnap,
  deleteBusinessForever,
  editBusiness,
  recent,
  rejectBusiness,
  removeBusiness,
  restoreBusiness,
  setBusinessVerified,
  setSeedHidden,
  useLive,
} from '../api';
import { useAdmin } from '../AdminContext';
import { useRunner } from '../useRunner';
import { Badge, Btn, Card, EmptyState, ErrorNote, Field, Modal, PageHeader, SearchBox, Spinner, Tabs, inputCls, shortDate, statusTone, useConfirm } from '../ui';

type Tab = 'pending' | 'approved' | 'rejected' | 'removed' | 'all' | 'builtin';

const Detail: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) =>
  children ? (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="text-[13px] text-slate-800 dark:text-slate-200 break-words">{children}</dd>
    </div>
  ) : null;

const ExtLink: React.FC<{ href?: string; children?: React.ReactNode }> = ({ href, children }) =>
  href ? (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1">
      {children ?? href} <ExternalLink size={11} />
    </a>
  ) : null;

// ---------------------------------------------------------------------------
// Edit dialog
// ---------------------------------------------------------------------------

const EditDialog: React.FC<{ business: Business; onClose: () => void }> = ({ business, onClose }) => {
  const { admin } = useAdmin();
  const { busy, run } = useRunner();
  const [f, setF] = useState<BusinessEdit>({
    name: business.name,
    category: business.category,
    state: business.state,
    lga: business.lga,
    address: business.address,
    phone: business.phone,
    whatsapp: business.whatsapp ?? '',
    email: business.email ?? '',
    website: business.website ?? '',
    openingHours: business.openingHours ?? '',
    description: business.description ?? '',
  });
  const set = (k: keyof BusinessEdit) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    if (await run('edit', () => editBusiness(admin, business, f), 'Listing updated')) onClose();
  };

  return (
    <Modal
      title={`Edit: ${business.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={busy === 'edit'} onClick={save}>Save changes</Btn>
        </>
      }
    >
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Use this to fix typos or formatting before approving. The owner is not notified automatically.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Business name" htmlFor="e-name"><input id="e-name" className={inputCls} maxLength={120} value={f.name} onChange={set('name')} /></Field>
        <Field label="Category" htmlFor="e-cat">
          <select id="e-cat" className={inputCls} value={f.category} onChange={set('category')}>
            {CATEGORIES.filter((c) => c.key !== 'All').map((c) => <option key={c.key} value={c.key}>{c.key}</option>)}
            {!CATEGORIES.some((c) => c.key === f.category) && <option value={f.category}>{f.category}</option>}
          </select>
        </Field>
        <Field label="State" htmlFor="e-state">
          <select id="e-state" className={inputCls} value={f.state} onChange={set('state')}>
            {STATES_DATA.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Local Government Area" htmlFor="e-lga"><input id="e-lga" className={inputCls} maxLength={80} value={f.lga} onChange={set('lga')} /></Field>
        <div className="sm:col-span-2"><Field label="Address" htmlFor="e-addr"><input id="e-addr" className={inputCls} maxLength={250} value={f.address} onChange={set('address')} /></Field></div>
        <Field label="Phone" htmlFor="e-phone"><input id="e-phone" className={inputCls} maxLength={25} value={f.phone} onChange={set('phone')} /></Field>
        <Field label="WhatsApp" htmlFor="e-wa"><input id="e-wa" className={inputCls} maxLength={25} value={f.whatsapp} onChange={set('whatsapp')} /></Field>
        <Field label="Email" htmlFor="e-email"><input id="e-email" className={inputCls} maxLength={150} value={f.email} onChange={set('email')} /></Field>
        <Field label="Website" htmlFor="e-web"><input id="e-web" className={inputCls} maxLength={300} value={f.website} onChange={set('website')} /></Field>
        <div className="sm:col-span-2"><Field label="Opening hours" htmlFor="e-hours"><input id="e-hours" className={inputCls} maxLength={120} value={f.openingHours} onChange={set('openingHours')} /></Field></div>
        <div className="sm:col-span-2"><Field label="Description" htmlFor="e-desc"><textarea id="e-desc" rows={4} className={inputCls} maxLength={2000} value={f.description} onChange={set('description')} /></Field></div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// One community listing
// ---------------------------------------------------------------------------

const BusinessRow: React.FC<{ b: Business; busy: string | null; run: ReturnType<typeof useRunner>['run'] }> = ({ b, busy, run }) => {
  const { admin } = useAdmin();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const isBusy = busy?.endsWith(`:${b.id}`) ?? false;

  const reject = async () => {
    const r = await confirm({ title: `Reject “${b.name}”?`, message: 'The owner will see your note under My Submissions.', confirmLabel: 'Reject listing', tone: 'danger', reason: { label: 'Reason shown to the owner', placeholder: 'e.g. The Google Maps link doesn’t match the address.', required: true } });
    if (r.ok) run(`reject:${b.id}`, () => rejectBusiness(admin, b, r.reason), 'Listing rejected');
  };
  const remove = async () => {
    const r = await confirm({ title: `Remove “${b.name}” from the site?`, message: 'It disappears from the public directory immediately. You can restore it later.', confirmLabel: 'Remove listing', tone: 'danger', reason: { label: 'Reason (shown to the owner)', placeholder: 'e.g. Reported as a duplicate.', required: true } });
    if (r.ok) run(`remove:${b.id}`, () => removeBusiness(admin, b, r.reason), 'Listing removed');
  };
  const destroy = async () => {
    const r = await confirm({ title: `Delete “${b.name}” forever?`, message: 'This permanently erases the listing and cannot be undone.', confirmLabel: 'Delete forever', tone: 'danger' });
    if (r.ok) run(`delete:${b.id}`, () => deleteBusinessForever(admin, b), 'Listing deleted');
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="font-extrabold text-slate-900 dark:text-white break-words">{b.name}</h3>
            <Badge tone={statusTone(b.status)}>{b.status}</Badge>
            {b.isVerified && <Badge tone="sky"><BadgeCheck size={11} /> Verified</Badge>}
            {b.claimed && <Badge tone="violet">Claimed</Badge>}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {b.category} · {b.lga}, {b.state} · by <b>{b.ownerName || 'Unknown'}</b> · submitted {shortDate(b.createdAt)}
          </p>
          {b.moderationNote && <p className="text-[11px] mt-1 text-rose-700 dark:text-rose-300">Note: {b.moderationNote}</p>}
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-xs font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 cursor-pointer">
          Details <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
          <Detail label="Phone">{b.phone}</Detail>
          <Detail label="WhatsApp">{b.whatsapp}</Detail>
          <Detail label="Other phone">{b.secondaryPhone}</Detail>
          <Detail label="Email">{b.email}</Detail>
          <Detail label="Website"><ExtLink href={b.website} /></Detail>
          <Detail label="Google Maps"><ExtLink href={b.googleMapUrl}>Open map link</ExtLink></Detail>
          <Detail label="Address">{b.address}{b.landmark ? ` (near ${b.landmark})` : ''}</Detail>
          <Detail label="CAC (self-declared)">{b.cacNumber ? `${b.cacNumber} · ${b.cacStatus}` : b.cacStatus}</Detail>
          <Detail label="Opening hours">{b.openingHours}</Detail>
          <Detail label="Established">{b.yearEstablished}</Detail>
          <Detail label="Price level">{b.priceLevel}</Detail>
          <Detail label="Payments">{b.paymentMethods?.join(', ')}</Detail>
          <Detail label="Tags">{b.tags?.join(', ')}</Detail>
          <Detail label="Socials">
            {Object.entries(b.socials ?? {}).map(([k, v]) => (
              <span key={k} className="mr-3"><ExtLink href={v as string}>{k}</ExtLink></span>
            ))}
          </Detail>
          <Detail label="Owner account ID"><code className="text-[11px]">{b.ownerId}</code></Detail>
          <div className="sm:col-span-2 lg:col-span-3"><Detail label="Description"><span className="whitespace-pre-line">{b.description}</span></Detail></div>
        </dl>
      )}

      <div className="mt-3.5 flex flex-wrap gap-2">
        {b.status === 'pending' && (
          <>
            <Btn variant="primary" icon={<Check size={13} />} loading={busy === `approve:${b.id}`} disabled={isBusy} onClick={() => run(`approve:${b.id}`, () => approveBusiness(admin, b, false), 'Approved: now live')}>Approve</Btn>
            <Btn variant="outline" icon={<BadgeCheck size={13} />} loading={busy === `approveverify:${b.id}`} disabled={isBusy} onClick={() => run(`approveverify:${b.id}`, () => approveBusiness(admin, b, true), 'Approved & verified')}>Approve &amp; verify</Btn>
            <Btn variant="outline" icon={<X size={13} />} disabled={isBusy} onClick={reject}>Reject…</Btn>
          </>
        )}
        {b.status === 'approved' && (
          <Btn
            variant="outline"
            icon={b.isVerified ? <ShieldOff size={13} /> : <BadgeCheck size={13} />}
            loading={busy === `verify:${b.id}`}
            disabled={isBusy}
            onClick={() => run(`verify:${b.id}`, () => setBusinessVerified(admin, b, !b.isVerified), b.isVerified ? 'Verified badge removed' : 'Listing verified')}
          >
            {b.isVerified ? 'Remove verified badge' : 'Mark as verified'}
          </Btn>
        )}
        {(b.status === 'rejected' || b.status === 'removed') && (
          <Btn variant="primary" icon={<RotateCcw size={13} />} loading={busy === `restore:${b.id}`} disabled={isBusy} onClick={() => run(`restore:${b.id}`, () => restoreBusiness(admin, b), 'Restored: now live')}>
            {b.status === 'rejected' ? 'Approve anyway' : 'Restore'}
          </Btn>
        )}
        {b.status !== 'removed' && <Btn variant="outline" icon={<Pencil size={13} />} disabled={isBusy} onClick={() => setEditing(true)}>Edit</Btn>}
        {(b.status === 'pending' || b.status === 'approved') && <Btn variant="outline" icon={<Ban size={13} />} disabled={isBusy} onClick={remove}>Remove…</Btn>}
        {(b.status === 'rejected' || b.status === 'removed') && <Btn variant="danger" icon={<Trash2 size={13} />} disabled={isBusy} onClick={destroy}>Delete forever</Btn>}
      </div>

      {editing && <EditDialog business={b} onClose={() => setEditing(false)} />}
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Built-in directory (seed data): search, hide / restore
// ---------------------------------------------------------------------------

const BuiltIn: React.FC = () => {
  const { admin, overrides } = useAdmin();
  const { busy, run } = useRunner();
  const confirm = useConfirm();
  const [term, setTerm] = useState('');
  const deferred = useDeferredValue(term.trim().toLowerCase());

  const hidden = useMemo(() => new Map(overrides.filter((o) => o.kind === 'business' && o.hidden).map((o) => [o.id, o])), [overrides]);

  const results = useMemo(() => {
    if (deferred.length < 2) return [];
    const out: Business[] = [];
    for (const b of INITIAL_BUSINESSES) {
      if (b.name.toLowerCase().includes(deferred) || b.id.toLowerCase() === deferred || b.phone.replace(/\s/g, '').includes(deferred.replace(/\s/g, ''))) {
        out.push(b);
        if (out.length >= 40) break;
      }
    }
    return out;
  }, [deferred]);

  const hiddenList = useMemo(() => [...hidden.keys()].map((id) => INITIAL_BUSINESSES.find((b) => b.id === id)).filter((b): b is Business => !!b), [hidden]);

  const toggle = async (b: Business, hide: boolean) => {
    if (hide) {
      const r = await confirm({ title: `Hide “${b.name}”?`, message: 'It will no longer appear anywhere on the public site. You can restore it from this page.', confirmLabel: 'Hide listing', tone: 'danger' });
      if (!r.ok) return;
    }
    run(`seed:${b.id}`, () => setSeedHidden(admin, 'business', b.id, b.name, hide, hidden.get(b.id) ?? overrides.find((o) => o.kind === 'business' && o.id === b.id)), hide ? 'Listing hidden' : 'Listing restored');
  };

  const row = (b: Business) => {
    const isHidden = hidden.has(b.id);
    return (
      <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="min-w-0">
          <p className="font-bold text-sm text-slate-900 dark:text-white break-words">{b.name}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{b.category} · {b.lga}, {b.state} · <code>{b.id}</code></p>
        </div>
        <div className="flex items-center gap-2">
          {b.isSample ? <Badge tone="amber" title="Generated placeholder listing">Sample</Badge> : <Badge tone="green">Curated</Badge>}
          {isHidden && <Badge tone="red">Hidden</Badge>}
          <Btn variant={isHidden ? 'primary' : 'outline'} icon={isHidden ? <Eye size={13} /> : <EyeOff size={13} />} loading={busy === `seed:${b.id}`} onClick={() => toggle(b, !isHidden)}>
            {isHidden ? 'Restore' : 'Hide'}
          </Btn>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
          These are the {INITIAL_BUSINESSES.length.toLocaleString()} listings bundled with the site. You can’t edit them here, but you can <b>hide</b> any that are wrong, fake or abusive, and restore them later.
        </p>
        <SearchBox value={term} onChange={setTerm} placeholder="Search by business name, phone number or listing ID (2+ characters)" />
      </Card>

      {deferred.length >= 2 ? (
        results.length ? (
          <div className="space-y-2">
            {results.map(row)}
            {results.length >= 40 && <p className="text-xs text-slate-500 text-center">Showing the first 40 matches. Refine your search to narrow it down.</p>}
          </div>
        ) : (
          <Card><EmptyState icon={<Building2 size={22} />} title="No built-in listings match" /></Card>
        )
      ) : null}

      {hiddenList.length > 0 && (
        <div>
          <h2 className="text-sm font-extrabold text-slate-800 dark:text-slate-100 mb-2">Currently hidden ({hiddenList.length})</h2>
          <div className="space-y-2">{hiddenList.map(row)}</div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Businesses() {
  const [tab, setTab] = useState<Tab>('pending');
  const [term, setTerm] = useState('');
  const { busy, run } = useRunner();
  const { data, loading, error } = useLive(() => recent(COL.businesses), businessFromSnap, []);

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0, removed: 0 };
    data.forEach((b) => {
      if (b.status && b.status in c) c[b.status as keyof typeof c] += 1;
    });
    return c;
  }, [data]);

  const q = term.trim().toLowerCase();
  const rows = useMemo(
    () =>
      data
        .filter((b) => tab === 'all' || b.status === tab)
        .filter((b) => !q || [b.name, b.category, b.state, b.lga, b.ownerName, b.phone, b.ownerId].some((v) => (v ?? '').toLowerCase().includes(q))),
    [data, tab, q],
  );

  return (
    <>
      <PageHeader
        title="Businesses"
        subtitle="Review new listings before they go live, verify trusted businesses, and remove anything that breaks the rules."
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'pending', label: 'Pending', count: counts.pending, alert: true },
          { id: 'approved', label: 'Live', count: counts.approved },
          { id: 'rejected', label: 'Rejected', count: counts.rejected },
          { id: 'removed', label: 'Removed', count: counts.removed },
          { id: 'all', label: 'All', count: data.length },
          { id: 'builtin', label: 'Built-in directory' },
        ]}
      />

      {tab === 'builtin' ? (
        <BuiltIn />
      ) : (
        <>
          <SearchBox value={term} onChange={setTerm} placeholder="Search name, category, location, owner or phone" className="mb-4 max-w-md" />
          {error && <ErrorNote>{error}</ErrorNote>}
          {loading ? (
            <Spinner />
          ) : rows.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Building2 size={22} />}
                title={tab === 'pending' ? 'Nothing waiting for review 🎉' : 'No listings here'}
                hint={tab === 'pending' ? 'New business submissions from members will appear here.' : undefined}
              />
            </Card>
          ) : (
            <div className="space-y-3">
              {rows.map((b) => (
                <BusinessRow key={b.id} b={b} busy={busy} run={run} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
