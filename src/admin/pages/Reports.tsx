import React, { useMemo, useState } from 'react';
import { Ban, CheckCheck, ChevronDown, Flag, Loader2, Trash2, UserX, X } from 'lucide-react';
import { ReportRecord } from '../../types';
import { TargetInfo, actOnReport, fetchAdminReports, loadTarget, useAdminQuery } from '../api';
import { useAdmin } from '../AdminContext';
import { useRunner } from '../useRunner';
import { Badge, Btn, Card, EmptyState, ErrorNote, PageHeader, Spinner, Tabs, formatDate, statusTone, useConfirm } from '../ui';

type Tab = 'open' | 'resolved' | 'dismissed';

const typeLabel = { business: 'Business listing', ad: 'Marketplace ad', review: 'Review' } as const;

const ReportCard: React.FC<{ r: ReportRecord; sameTarget: number; busy: string | null; run: ReturnType<typeof useRunner>['run'] }> = ({ r, sameTarget, busy, run }) => {
  const { admin } = useAdmin();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<TargetInfo | null>(null);
  const [ownerIsAdmin, setOwnerIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const isOpen = r.status === 'open';
  const isBusy = busy === `report:${r.id}`;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !target) {
      setLoading(true);
      const t = await loadTarget(r);
      setTarget(t);
      setOwnerIsAdmin(Boolean(t.ownerIsAdmin));
      setLoading(false);
    }
  };

  const canRemove = target && target.kind !== 'missing' && target.status !== 'removed';
  const canBan = !!target?.ownerId && target.kind === 'community' && !ownerIsAdmin;

  const dismiss = async () => {
    const c = await confirm({ title: 'Dismiss this report?', message: 'Use this when the report is mistaken or the content is fine. The content stays live.', confirmLabel: 'Dismiss report', reason: { label: 'Internal note (optional)' } });
    if (c.ok) run(`report:${r.id}`, () => actOnReport(admin, r, target ?? { kind: 'missing', title: r.targetTitle }, { status: 'dismissed', note: c.reason || 'No action needed' }), 'Report dismissed');
  };
  const resolve = async () => {
    const c = await confirm({ title: 'Mark as resolved?', message: 'Records that you dealt with this report without removing anything.', confirmLabel: 'Mark resolved', reason: { label: 'Internal note (optional)' } });
    if (c.ok) run(`report:${r.id}`, () => actOnReport(admin, r, target ?? { kind: 'missing', title: r.targetTitle }, { status: 'resolved', note: c.reason || 'Handled' }), 'Report resolved');
  };
  const removeContent = async () => {
    if (!target) return;
    const c = await confirm({
      title: 'Remove the reported content?',
      message: target.kind === 'builtin' ? 'This built-in listing will be hidden from the public site.' : 'It disappears from the public site immediately.',
      confirmLabel: 'Remove content',
      tone: 'danger',
      reason: { label: 'Reason (shown to the owner)', required: true, placeholder: 'e.g. Confirmed as a scam.' },
    });
    if (c.ok) run(`report:${r.id}`, () => actOnReport(admin, r, target, { status: 'resolved', note: c.reason, removeContent: true }), 'Content removed and report resolved');
  };
  const removeAndBan = async () => {
    if (!target) return;
    const c = await confirm({
      title: `Remove content and suspend ${target.ownerName || 'the owner'}?`,
      message: 'The content is removed and the account can no longer list, post, review or report. Their other content stays until you remove it from Users.',
      confirmLabel: 'Remove & suspend',
      tone: 'danger',
      reason: { label: 'Reason', required: true, placeholder: 'e.g. Repeated scam ads.' },
    });
    if (c.ok) {
      run(
        `report:${r.id}`,
        () => actOnReport(admin, r, target, { status: 'resolved', note: c.reason, removeContent: !!canRemove, banOwner: { reason: c.reason, name: target.ownerName } }),
        'Content removed and owner suspended',
      );
    }
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="sky">{typeLabel[r.targetType]}</Badge>
            <Badge tone="red">{r.reason}</Badge>
            <Badge tone={statusTone(r.status)}>{r.status}</Badge>
            {sameTarget > 1 && <Badge tone="amber">{sameTarget} reports on this item</Badge>}
          </div>
          <h3 className="mt-1.5 font-extrabold text-slate-900 dark:text-white break-words">{r.targetTitle}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Reported by <b>{r.reporterName || 'a member'}</b> · {formatDate(r.createdAt)}
          </p>
          {r.details && <p className="mt-2 text-[13px] text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-lg p-3 whitespace-pre-line break-words">“{r.details}”</p>}
          {r.resolution && <p className="mt-2 text-[11px] text-slate-500">Resolution note: {r.resolution}</p>}
        </div>
        <button type="button" onClick={toggle} aria-expanded={open} className="text-xs font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 cursor-pointer">
          {isOpen ? 'Review' : 'Details'} <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="mt-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-[13px] text-slate-700 dark:text-slate-200">
          {loading || !target ? (
            <div className="flex items-center gap-2 text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading the reported item…</div>
          ) : (
            <div className="space-y-1.5">
              <p>
                <b>Item:</b> {target.title}{' '}
                <Badge tone={target.kind === 'missing' ? 'slate' : target.kind === 'builtin' ? 'amber' : 'green'}>
                  {target.kind === 'community' ? 'Member content' : target.kind === 'builtin' ? 'Built-in listing' : 'No longer exists'}
                </Badge>{' '}
                {target.status && <Badge tone={statusTone(target.status)}>{target.status}</Badge>}
              </p>
              {target.ownerId && (
                <p>
                  <b>Owner:</b> {target.ownerName || 'Unknown'} <code className="text-[11px]">{target.ownerId}</code> {ownerIsAdmin && <Badge tone="violet">Admin</Badge>}
                </p>
              )}
              {target.excerpt && <p className="text-slate-600 dark:text-slate-300 line-clamp-4 whitespace-pre-line break-words">{target.excerpt}</p>}
              <p className="text-[11px] text-slate-400">The owner shown here comes from the item itself, not from the report.</p>
            </div>
          )}
        </div>
      )}

      {isOpen && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          {open && target && canRemove && <Btn variant="outline" icon={<Trash2 size={13} />} disabled={isBusy} onClick={removeContent}>Remove content…</Btn>}
          {open && target && canBan && <Btn variant="danger" icon={<UserX size={13} />} disabled={isBusy} onClick={removeAndBan}>Remove &amp; suspend owner…</Btn>}
          {open && target && ownerIsAdmin && <span className="text-[11px] text-slate-500 self-center">Admins can’t be suspended from here.</span>}
          <Btn variant="outline" icon={<CheckCheck size={13} />} disabled={isBusy} onClick={resolve}>Mark resolved</Btn>
          <Btn variant="ghost" icon={<X size={13} />} disabled={isBusy} onClick={dismiss}>Dismiss</Btn>
          {!open && <span className="text-[11px] text-slate-500 self-center">Open “Review” to see the item and take action.</span>}
        </div>
      )}
    </Card>
  );
};

export default function Reports() {
  const [tab, setTab] = useState<Tab>('open');
  const { busy, run } = useRunner();
  const { data, loading, error } = useAdminQuery(() => fetchAdminReports(), [], []);

  const perTarget = useMemo(() => {
    const m = new Map<string, number>();
    data.forEach((r) => m.set(`${r.targetType}:${r.targetId}`, (m.get(`${r.targetType}:${r.targetId}`) ?? 0) + 1));
    return m;
  }, [data]);

  const counts = useMemo(() => ({ open: data.filter((r) => r.status === 'open').length, resolved: data.filter((r) => r.status === 'resolved').length, dismissed: data.filter((r) => r.status === 'dismissed').length }), [data]);
  const rows = useMemo(() => data.filter((r) => r.status === tab), [data, tab]);

  return (
    <>
      <PageHeader title="Reports" subtitle="Members flag listings, ads and reviews here. Review the item, then remove it, suspend the owner, or dismiss the report." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'open', label: 'Open', count: counts.open, alert: true },
          { id: 'resolved', label: 'Resolved', count: counts.resolved },
          { id: 'dismissed', label: 'Dismissed', count: counts.dismissed },
        ]}
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={tab === 'open' ? <Flag size={22} /> : <Ban size={22} />} title={tab === 'open' ? 'No open reports 🎉' : 'Nothing here yet'} /></Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <ReportCard key={r.id} r={r} sameTarget={perTarget.get(`${r.targetType}:${r.targetId}`) ?? 1} busy={busy} run={run} />
          ))}
        </div>
      )}
    </>
  );
}
