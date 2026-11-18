import React, { useMemo, useState } from 'react';
import { Star, Trash2, UserX } from 'lucide-react';
import { COL } from '../../lib/config';
import { INITIAL_BUSINESSES } from '../../data/nigeriaData';
import { ReviewRow, banUser, deleteReview, recent, reviewFromSnap, useLive } from '../api';
import { useAdmin } from '../AdminContext';
import { useRunner } from '../useRunner';
import { Btn, Card, EmptyState, ErrorNote, PageHeader, SearchBox, Spinner, formatDate, useConfirm } from '../ui';

export default function Reviews() {
  const { admin } = useAdmin();
  const { busy, run } = useRunner();
  const confirm = useConfirm();
  const [term, setTerm] = useState('');
  const { data, loading, error } = useLive(() => recent(COL.reviews), reviewFromSnap, []);

  // Business names for readability. Built lazily, once, when this page opens.
  const names = useMemo(() => new Map(INITIAL_BUSINESSES.map((b) => [b.id, b.name])), []);

  const q = term.trim().toLowerCase();
  const rows = useMemo(
    () => data.filter((r) => !q || [r.authorName, r.comment, r.businessId, names.get(r.businessId) ?? ''].some((v) => v.toLowerCase().includes(q))),
    [data, q, names],
  );

  const remove = async (r: ReviewRow) => {
    const c = await confirm({ title: 'Delete this review?', message: `By ${r.authorName}. This can’t be undone.`, confirmLabel: 'Delete review', tone: 'danger' });
    if (c.ok) run(`review:${r.id}`, () => deleteReview(admin, r), 'Review deleted');
  };

  const suspendAuthor = async (r: ReviewRow) => {
    const c = await confirm({
      title: `Suspend ${r.authorName}?`,
      message: 'They will no longer be able to list, post, review or report.',
      confirmLabel: 'Suspend account',
      tone: 'danger',
      reason: { label: 'Reason (shown to the member)', required: true, placeholder: 'e.g. Fake reviews.' },
      checkbox: { label: 'Also remove all their listings, ads and reviews', defaultChecked: true },
    });
    if (c.ok) run(`ban:${r.authorId}`, () => banUser(admin, { id: r.authorId, email: '', displayName: r.authorName }, c.reason, c.checked), 'Account suspended');
  };

  return (
    <>
      <PageHeader title="Reviews" subtitle="The most recent member reviews. Delete fake or abusive ones. (Members can also report reviews, and those arrive under Reports.)" />
      <SearchBox value={term} onChange={setTerm} placeholder="Search author, comment or business" className="mb-4 max-w-md" />
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={<Star size={22} />} title="No reviews yet" /></Card>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {r.authorName} <span className="text-amber-500">{'★'.repeat(r.rating)}<span className="text-slate-300 dark:text-slate-700">{'★'.repeat(5 - r.rating)}</span></span>
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    on <b>{names.get(r.businessId) ?? r.businessId}</b> · {formatDate(r.createdAt)}
                  </p>
                  <p className="mt-1.5 text-[13px] text-slate-700 dark:text-slate-200 whitespace-pre-line break-words">{r.comment}</p>
                </div>
                <div className="flex gap-2">
                  <Btn variant="outline" icon={<UserX size={13} />} disabled={busy === `ban:${r.authorId}`} onClick={() => suspendAuthor(r)}>Suspend author…</Btn>
                  <Btn variant="danger" icon={<Trash2 size={13} />} loading={busy === `review:${r.id}`} onClick={() => remove(r)}>Delete</Btn>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
