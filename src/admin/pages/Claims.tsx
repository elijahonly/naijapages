import React, { useMemo, useState } from 'react';
import { BadgeCheck, Check, ShieldCheck, X } from 'lucide-react';
import { COL } from '../../lib/config';
import { ClaimRecord } from '../../types';
import { approveClaim, claimFromSnap, recent, rejectClaim, useLive } from '../api';
import { useAdmin } from '../AdminContext';
import { useRunner } from '../useRunner';
import { Badge, Btn, Card, EmptyState, ErrorNote, PageHeader, Spinner, Tabs, formatDate, statusTone, useConfirm } from '../ui';

type Tab = 'pending' | 'approved' | 'rejected';

const ClaimCard: React.FC<{ c: ClaimRecord; busy: string | null; run: ReturnType<typeof useRunner>['run'] }> = ({ c, busy, run }) => {
  const { admin } = useAdmin();
  const confirm = useConfirm();
  const isBusy = busy === `claim:${c.id}`;

  const approve = async () => {
    const r = await confirm({
      title: `Approve the claim for “${c.businessName}”?`,
      message: (
        <>
          The business gets the <b>Verified</b> badge and is marked as claimed by <b>{c.name}</b>. Only approve once you’ve checked their proof (for example the CAC number on the CAC public search).
        </>
      ),
      confirmLabel: 'Approve & verify',
      reason: { label: 'Note (optional, visible to the claimant)' },
    });
    if (r.ok) run(`claim:${c.id}`, () => approveClaim(admin, c, r.reason), 'Claim approved; listing verified');
  };
  const reject = async () => {
    const r = await confirm({ title: 'Reject this claim?', confirmLabel: 'Reject claim', tone: 'danger', reason: { label: 'Reason (visible to the claimant)', required: true, placeholder: 'e.g. We couldn’t match the CAC number to this business.' } });
    if (r.ok) run(`claim:${c.id}`, () => rejectClaim(admin, c, r.reason), 'Claim rejected');
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="font-extrabold text-slate-900 dark:text-white break-words">{c.businessName}</h3>
            <Badge tone={statusTone(c.status)}>{c.status}</Badge>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Listing ID <code>{c.businessId}</code> · submitted {formatDate(c.createdAt)}</p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
        <div><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Claimant</dt><dd className="text-slate-800 dark:text-slate-100">{c.name} · {c.role}</dd></div>
        <div><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Contact</dt><dd className="text-slate-800 dark:text-slate-100 break-words"><a className="text-emerald-700 dark:text-emerald-400 hover:underline" href={`mailto:${encodeURIComponent(c.email).replace('%40', '@')}`}>{c.email}</a> · {c.phone}</dd></div>
        <div className="sm:col-span-2"><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Proof provided</dt><dd className="text-slate-800 dark:text-slate-100 whitespace-pre-line break-words">{c.proofNote || 'None given'}</dd></div>
        {c.reviewNote && <div className="sm:col-span-2"><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Review note</dt><dd className="text-slate-700 dark:text-slate-300">{c.reviewNote}</dd></div>}
      </dl>

      {c.status === 'pending' && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          <Btn variant="primary" icon={<BadgeCheck size={13} />} loading={isBusy} onClick={approve}>Approve &amp; verify…</Btn>
          <Btn variant="outline" icon={<X size={13} />} disabled={isBusy} onClick={reject}>Reject…</Btn>
        </div>
      )}
    </Card>
  );
};

export default function Claims() {
  const [tab, setTab] = useState<Tab>('pending');
  const { busy, run } = useRunner();
  const { data, loading, error } = useLive(() => recent(COL.claims), claimFromSnap, []);

  const counts = useMemo(() => ({ pending: data.filter((c) => c.status === 'pending').length, approved: data.filter((c) => c.status === 'approved').length, rejected: data.filter((c) => c.status === 'rejected').length }), [data]);
  const rows = useMemo(() => data.filter((c) => c.status === tab), [data, tab]);

  return (
    <>
      <PageHeader title="Ownership claims" subtitle="Business owners ask to be verified on an existing listing. Check their proof before approving: approval adds the Verified badge." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'pending', label: 'Pending', count: counts.pending, alert: true },
          { id: 'approved', label: 'Approved', count: counts.approved },
          { id: 'rejected', label: 'Rejected', count: counts.rejected },
        ]}
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={tab === 'approved' ? <Check size={22} /> : <ShieldCheck size={22} />} title={tab === 'pending' ? 'No claims waiting 🎉' : 'Nothing here yet'} /></Card>
      ) : (
        <div className="space-y-3">{rows.map((c) => <ClaimCard key={c.id} c={c} busy={busy} run={run} />)}</div>
      )}
    </>
  );
}
