import React, { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { COL } from '../../lib/config';
import { auditFromSnap, recent, useLive } from '../api';
import { Badge, Card, EmptyState, ErrorNote, PageHeader, SearchBox, Spinner, formatDate } from '../ui';

const LABELS: Record<string, string> = {
  'business.approve': 'Approved a business',
  'business.approve_verify': 'Approved & verified a business',
  'business.reject': 'Rejected a business',
  'business.remove': 'Removed a business',
  'business.restore': 'Restored a business',
  'business.verify': 'Verified a business',
  'business.unverify': 'Removed a verified badge',
  'business.delete': 'Deleted a business',
  'business.edit': 'Edited a business',
  'business.hide_builtin': 'Hid a built-in business',
  'business.restore_builtin': 'Restored a built-in business',
  'marketplace.hide_builtin': 'Hid a built-in ad',
  'marketplace.restore_builtin': 'Restored a built-in ad',
  'ad.approve': 'Approved an ad',
  'ad.remove': 'Removed an ad',
  'ad.restore': 'Restored an ad',
  'ad.delete': 'Deleted an ad',
  'review.delete': 'Deleted a review',
  'user.ban': 'Suspended a member',
  'user.unban': 'Reinstated a member',
  'admin.grant': 'Added an admin',
  'admin.revoke': 'Removed an admin',
  'claim.approve': 'Approved an ownership claim',
  'claim.reject': 'Rejected an ownership claim',
  'report.resolve': 'Resolved a report',
  'report.dismiss': 'Dismissed a report',
  'business.remove_via_report': 'Removed a business via a report',
  'ad.remove_via_report': 'Removed an ad via a report',
  'review.remove_via_report': 'Removed a review via a report',
  'message.delete': 'Deleted a message',
  'subscriber.delete': 'Removed a subscriber',
  'settings.update': 'Updated site settings',
};

const tone = (action: string) =>
  /ban|delete|remove|reject|revoke|unverify|hide/.test(action) ? 'red' : /approve|restore|grant|verify|unban/.test(action) ? 'green' : 'slate';

export default function Activity() {
  const [term, setTerm] = useState('');
  const { data, loading, error } = useLive(() => recent(COL.audit, 'createdAt', 200), auditFromSnap, []);

  const q = term.trim().toLowerCase();
  const rows = useMemo(
    () => data.filter((r) => !q || [r.adminEmail, r.action, LABELS[r.action] ?? '', r.summary ?? '', r.targetId ?? ''].some((v) => v.toLowerCase().includes(q))),
    [data, q],
  );

  return (
    <>
      <PageHeader title="Activity log" subtitle="A permanent record of every admin action: who did what, and when. Entries can’t be edited or deleted." />
      <SearchBox value={term} onChange={setTerm} placeholder="Search by admin, action or item" className="mb-4 max-w-md" />
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={<History size={22} />} title="No activity yet" hint="Actions you take in the admin site will be listed here." /></Card>
      ) : (
        <Card className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => (
            <div key={r.id} className="px-4 py-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={tone(r.action)}>{LABELS[r.action] ?? r.action}</Badge>
                  <span className="text-xs text-slate-500 dark:text-slate-400">by <b>{r.adminEmail || 'an admin'}</b></span>
                </div>
                {r.summary && <p className="text-[13px] text-slate-700 dark:text-slate-200 mt-1 break-words">{r.summary}</p>}
              </div>
              <time className="text-[11px] text-slate-400 whitespace-nowrap">{formatDate(r.createdAt)}</time>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
