import React, { useEffect, useMemo, useState } from 'react';
import { Activity as ActivityIcon, ShieldCheck, ShieldOff, UserCheck, UserX, Users as UsersIcon } from 'lucide-react';
import { Business, MarketplaceItem } from '../../types';
import {
  AdminRow,
  AdminUsersPayload,
  BanRow,
  ReviewRow,
  UserRow,
  banUser,
  fetchAdminUsers,
  grantAdmin,
  loadUserActivity,
  revokeAdmin,
  unbanUser,
  useAdminQuery,
} from '../api';
import { useAdmin } from '../AdminContext';
import { useRunner } from '../useRunner';
import { Badge, Btn, Card, EmptyState, ErrorNote, Modal, PageHeader, SearchBox, Spinner, Tabs, initials, shortDate, statusTone, useConfirm } from '../ui';

type Tab = 'all' | 'suspended' | 'admins';

// ---------------------------------------------------------------------------
// Activity viewer
// ---------------------------------------------------------------------------

const ActivityDialog: React.FC<{ user: UserRow; onClose: () => void }> = ({ user, onClose }) => {
  const [state, setState] = useState<{ businesses: Business[]; ads: MarketplaceItem[]; reviews: ReviewRow[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    loadUserActivity(user.id)
      .then((r) => alive && setState(r))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [user.id]);

  return (
    <Modal title={`Activity: ${user.displayName || user.email}`} onClose={onClose} wide footer={<Btn variant="outline" onClick={onClose}>Close</Btn>}>
      {error ? (
        <ErrorNote>We couldn’t load this member’s activity.</ErrorNote>
      ) : !state ? (
        <Spinner />
      ) : (
        <div className="space-y-5 text-sm">
          <section>
            <h3 className="font-extrabold text-slate-800 dark:text-slate-100 mb-1.5">Business listings ({state.businesses.length})</h3>
            {state.businesses.length === 0 ? <p className="text-xs text-slate-500">None.</p> : (
              <ul className="space-y-1.5">
                {state.businesses.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 text-[13px] border border-slate-100 dark:border-slate-800 rounded-lg px-3 py-2">
                    <span className="min-w-0 truncate">{b.name} <span className="text-slate-400">· {b.lga}, {b.state}</span></span>
                    <Badge tone={statusTone(b.status)}>{b.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="font-extrabold text-slate-800 dark:text-slate-100 mb-1.5">Marketplace ads ({state.ads.length})</h3>
            {state.ads.length === 0 ? <p className="text-xs text-slate-500">None.</p> : (
              <ul className="space-y-1.5">
                {state.ads.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 text-[13px] border border-slate-100 dark:border-slate-800 rounded-lg px-3 py-2">
                    <span className="min-w-0 truncate">{a.title} <span className="text-slate-400">· ₦{a.price.toLocaleString()}</span></span>
                    <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="font-extrabold text-slate-800 dark:text-slate-100 mb-1.5">Reviews written ({state.reviews.length})</h3>
            {state.reviews.length === 0 ? <p className="text-xs text-slate-500">None.</p> : (
              <ul className="space-y-1.5">
                {state.reviews.map((r) => (
                  <li key={r.id} className="text-[13px] border border-slate-100 dark:border-slate-800 rounded-lg px-3 py-2">
                    <span className="font-bold">{r.rating}★</span> <span className="text-slate-400">on {r.businessId}</span>
                    <p className="text-slate-600 dark:text-slate-300 line-clamp-2 break-words">{r.comment}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Users() {
  const { admin } = useAdmin();
  const { busy, run } = useRunner();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('all');
  const [term, setTerm] = useState('');
  const [viewing, setViewing] = useState<UserRow | null>(null);

  const EMPTY_USERS: AdminUsersPayload = { users: [], bans: [], admins: [] };
  const usersQuery = useAdminQuery(() => fetchAdminUsers(), EMPTY_USERS, []);
  const usersList = usersQuery.data.users;
  const bansList = usersQuery.data.bans;
  const adminsList = usersQuery.data.admins;

  const banById = useMemo(() => new Map<string, BanRow>(bansList.map((b) => [b.id, b])), [bansList]);
  const adminById = useMemo(() => new Map<string, AdminRow>(adminsList.map((a) => [a.id, a])), [adminsList]);

  // Admins and suspended accounts that have no profile row (e.g. created by hand) should still be listed.
  const allRows = useMemo<UserRow[]>(() => {
    const known = new Set(usersList.map((u) => u.id));
    const extras: UserRow[] = [];
    [...adminsList, ...bansList].forEach((x) => {
      if (!known.has(x.id)) {
        known.add(x.id);
        extras.push({ id: x.id, email: x.email ?? '', displayName: ('name' in x && x.name) || '' });
      }
    });
    return [...usersList, ...extras];
  }, [usersList, adminsList, bansList]);

  const q = term.trim().toLowerCase();
  const rows = useMemo(
    () =>
      allRows
        .filter((u) => (tab === 'all' ? true : tab === 'suspended' ? banById.has(u.id) : adminById.has(u.id)))
        .filter((u) => !q || [u.displayName, u.email, u.id].some((v) => v.toLowerCase().includes(q))),
    [allRows, tab, q, banById, adminById],
  );

  const suspend = async (u: UserRow) => {
    const r = await confirm({
      title: `Suspend ${u.displayName || u.email}?`,
      message: 'They will no longer be able to list businesses, post ads, write reviews or send reports. They can still browse and contact you to appeal.',
      confirmLabel: 'Suspend account',
      tone: 'danger',
      reason: { label: 'Reason (shown to the member)', required: true, placeholder: 'e.g. Repeated fraudulent ads.' },
      checkbox: { label: 'Also remove all their listings, ads and reviews', defaultChecked: true },
    });
    if (!r.ok) return;
    run(
      `ban:${u.id}`,
      async () => {
        const { removed } = await banUser(admin, u, r.reason, r.checked);
        return removed;
      },
      'Account suspended',
    );
  };

  const reinstate = async (u: UserRow) => {
    const r = await confirm({ title: `Reinstate ${u.displayName || u.email}?`, message: 'They will be able to post again. Content that was removed is not restored automatically.', confirmLabel: 'Reinstate' });
    if (r.ok) run(`ban:${u.id}`, () => unbanUser(admin, u), 'Account reinstated');
  };

  const makeAdmin = async (u: UserRow) => {
    const r = await confirm({ title: `Make ${u.displayName || u.email} an admin?`, message: 'Admins can approve and remove content, suspend members, read messages and manage other admins. Only add people you fully trust.', confirmLabel: 'Make admin' });
    if (r.ok) run(`admin:${u.id}`, () => grantAdmin(admin, u), 'Admin added');
  };

  const removeAdmin = async (u: UserRow) => {
    const r = await confirm({ title: `Remove admin rights from ${u.displayName || u.email}?`, confirmLabel: 'Remove admin', tone: 'danger' });
    if (r.ok) run(`admin:${u.id}`, () => revokeAdmin(admin, u), 'Admin rights removed');
  };

  const loading = usersQuery.loading;
  const error = usersQuery.error;

  return (
    <>
      <PageHeader title="Users & admins" subtitle="Everyone who has signed in appears here. Suspend abusers, reinstate people, and manage who is an administrator." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'all', label: 'All members', count: allRows.length },
          { id: 'suspended', label: 'Suspended', count: bansList.length },
          { id: 'admins', label: 'Admins', count: adminsList.length },
        ]}
      />
      <SearchBox value={term} onChange={setTerm} placeholder="Search name, email or user ID" className="mb-4 max-w-md" />
      {error && <ErrorNote>{error}</ErrorNote>}

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={<UsersIcon size={22} />} title="No members match" /></Card>
      ) : (
        <div className="space-y-2.5">
          {rows.map((u) => {
            const ban = banById.get(u.id);
            const isAdminUser = adminById.has(u.id);
            const isSelf = u.id === admin.uid;
            const rowBusy = busy?.endsWith(`:${u.id}`) ?? false;
            return (
              <Card key={u.id} className="p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-black text-sm shrink-0">
                      {initials(u.displayName || u.email)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="font-bold text-sm text-slate-900 dark:text-white truncate">{u.displayName || '(no name)'}</p>
                        {isAdminUser && <Badge tone="violet">Admin</Badge>}
                        {ban && <Badge tone="red">Suspended</Badge>}
                        {isSelf && <Badge tone="slate">You</Badge>}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{u.email || 'no email'} · joined {shortDate(u.createdAt)}</p>
                      {ban?.reason && <p className="text-[11px] text-rose-700 dark:text-rose-300">Reason: {ban.reason}</p>}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Btn icon={<ActivityIcon size={13} />} onClick={() => setViewing(u)}>Activity</Btn>
                    {ban ? (
                      <Btn variant="primary" icon={<UserCheck size={13} />} loading={busy === `ban:${u.id}`} disabled={rowBusy} onClick={() => reinstate(u)}>Reinstate</Btn>
                    ) : (
                      !isAdminUser && !isSelf && <Btn variant="outline" icon={<UserX size={13} />} loading={busy === `ban:${u.id}`} disabled={rowBusy} onClick={() => suspend(u)}>Suspend…</Btn>
                    )}
                    {!isSelf && (isAdminUser ? (
                      <Btn variant="outline" icon={<ShieldOff size={13} />} loading={busy === `admin:${u.id}`} disabled={rowBusy} onClick={() => removeAdmin(u)}>Remove admin</Btn>
                    ) : (
                      !ban && <Btn variant="outline" icon={<ShieldCheck size={13} />} loading={busy === `admin:${u.id}`} disabled={rowBusy} onClick={() => makeAdmin(u)}>Make admin</Btn>
                    ))}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {viewing && <ActivityDialog user={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
