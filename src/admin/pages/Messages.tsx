import React, { useMemo, useState } from 'react';
import { Archive, ChevronDown, Download, Inbox, Mail, MailOpen, Trash2, Users as UsersIcon } from 'lucide-react';
import { csvCell } from '../../lib/security';
import {
  MessageRow,
  SubscriberRow,
  deleteMessage,
  deleteSubscriber,
  fetchAdminMessages,
  fetchAdminSubscribers,
  setMessageStatus,
  useAdminQuery,
} from '../api';
import { useAdmin } from '../AdminContext';
import { useRunner } from '../useRunner';
import { Badge, Btn, Card, EmptyState, ErrorNote, PageHeader, SearchBox, Spinner, Tabs, formatDate, shortDate, statusTone, useConfirm } from '../ui';

type Section = 'messages' | 'newsletter';
type Filter = 'new' | 'read' | 'archived' | 'all';

const MessageCard: React.FC<{ m: MessageRow; busy: string | null; run: ReturnType<typeof useRunner>['run']; onOpened: (id: string) => void }> = ({ m, busy, run, onOpened }) => {
  const { admin } = useAdmin();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const isBusy = busy?.endsWith(`:${m.id}`) ?? false;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && m.status === 'new') {
      onOpened(m.id); // keep it listed while it is open, even though it is no longer "new"
      void run(`read:${m.id}`, () => setMessageStatus(admin, m.id, 'read'));
    }
  };

  const remove = async () => {
    const r = await confirm({ title: 'Delete this message?', message: `From ${m.name}. This can’t be undone.`, confirmLabel: 'Delete', tone: 'danger' });
    if (r.ok) run(`delete:${m.id}`, () => deleteMessage(admin, m), 'Message deleted');
  };

  const reply = `mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.subject}`)}`;

  return (
    <Card className={`p-4 ${m.status === 'new' ? 'border-l-4 border-l-amber-400' : ''}`}>
      <button type="button" onClick={toggle} aria-expanded={open} className="w-full text-left cursor-pointer">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className={`text-sm break-words ${m.status === 'new' ? 'font-black' : 'font-bold'} text-slate-900 dark:text-white`}>{m.subject}</p>
              <Badge tone={statusTone(m.status)}>{m.status}</Badge>
              {m.uid && <Badge tone="sky">Signed-in member</Badge>}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{m.name} · {m.email} · {formatDate(m.createdAt)}</p>
            {!open && <p className="text-[13px] text-slate-600 dark:text-slate-300 mt-1 line-clamp-1 break-words">{m.message}</p>}
          </div>
          <ChevronDown size={16} className={`text-slate-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open && (
        <>
          <p className="mt-3 text-[13px] text-slate-800 dark:text-slate-100 whitespace-pre-line break-words bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-xl p-4">{m.message}</p>
          {m.uid && <p className="text-[11px] text-slate-400 mt-2">Member ID: <code>{m.uid}</code></p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={reply} className="inline-flex items-center gap-1.5 rounded-lg border border-transparent bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5">
              <Mail size={13} /> Reply by email
            </a>
            {m.status !== 'new' && <Btn icon={<MailOpen size={13} />} disabled={isBusy} onClick={() => run(`unread:${m.id}`, () => setMessageStatus(admin, m.id, 'new'), 'Marked as new')}>Mark as new</Btn>}
            {m.status !== 'archived' && <Btn icon={<Archive size={13} />} disabled={isBusy} onClick={() => run(`archive:${m.id}`, () => setMessageStatus(admin, m.id, 'archived'), 'Archived')}>Archive</Btn>}
            <Btn variant="danger" icon={<Trash2 size={13} />} disabled={isBusy} onClick={remove}>Delete</Btn>
          </div>
        </>
      )}
    </Card>
  );
};

const MessagesPane: React.FC = () => {
  const [filter, setFilter] = useState<Filter>('new');
  const [term, setTerm] = useState('');
  const { busy, run } = useRunner();
  const { data, loading, error } = useAdminQuery(() => fetchAdminMessages(), [], []);
  // Messages opened during this visit stay in the list until the tab changes (otherwise opening one in "New" would make it vanish).
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const changeFilter = (f: Filter) => {
    setOpened(new Set());
    setFilter(f);
  };

  const counts = useMemo(() => ({ new: data.filter((m) => m.status === 'new').length, read: data.filter((m) => m.status === 'read').length, archived: data.filter((m) => m.status === 'archived').length }), [data]);
  const q = term.trim().toLowerCase();
  const rows = useMemo(
    () => data.filter((m) => filter === 'all' || m.status === filter || opened.has(m.id)).filter((m) => !q || [m.name, m.email, m.subject, m.message].some((v) => v.toLowerCase().includes(q))),
    [data, filter, q, opened],
  );

  return (
    <>
      <Tabs<Filter>
        value={filter}
        onChange={changeFilter}
        items={[
          { id: 'new', label: 'New', count: counts.new, alert: true },
          { id: 'read', label: 'Read', count: counts.read },
          { id: 'archived', label: 'Archived', count: counts.archived },
          { id: 'all', label: 'All', count: data.length },
        ]}
      />
      <SearchBox value={term} onChange={setTerm} placeholder="Search name, email, subject or message" className="mb-4 max-w-md" />
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={<Inbox size={22} />} title={filter === 'new' ? 'Inbox zero 🎉' : 'No messages here'} hint="Messages sent from the Contact Us page arrive here." /></Card>
      ) : (
        <div className="space-y-2.5">{rows.map((m) => <MessageCard key={m.id} m={m} busy={busy} run={run} onOpened={(id) => setOpened((s) => new Set(s).add(id))} />)}</div>
      )}
    </>
  );
};

const Newsletter: React.FC = () => {
  const { admin } = useAdmin();
  const { busy, run } = useRunner();
  const confirm = useConfirm();
  const [term, setTerm] = useState('');
  const { data, loading, error } = useAdminQuery(() => fetchAdminSubscribers(), [], []);

  const q = term.trim().toLowerCase();
  const rows = useMemo(() => data.filter((s) => !q || s.email.toLowerCase().includes(q)), [data, q]);

  const exportCsv = () => {
    const lines = [['email', 'subscribed_at', 'source'].map(csvCell).join(',')];
    data.forEach((s) => lines.push([s.email, s.subscribedAt ? new Date(s.subscribedAt).toISOString() : '', s.source ?? ''].map(csvCell).join(',')));
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `naijapages-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const remove = async (s: SubscriberRow) => {
    const r = await confirm({ title: 'Remove this subscriber?', message: s.email, confirmLabel: 'Remove', tone: 'danger' });
    if (r.ok) run(`sub:${s.id}`, () => deleteSubscriber(admin, s), 'Subscriber removed');
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <SearchBox value={term} onChange={setTerm} placeholder="Search subscriber email" className="w-full max-w-md" />
        <Btn variant="primary" icon={<Download size={13} />} onClick={exportCsv} disabled={data.length === 0}>Export CSV ({data.length})</Btn>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={<UsersIcon size={22} />} title="No subscribers yet" hint="People who sign up through the newsletter banner appear here." /></Card>
      ) : (
        <Card className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{s.email}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{shortDate(s.subscribedAt)}{s.source ? ` · ${s.source}` : ''}</p>
              </div>
              <Btn variant="ghost" icon={<Trash2 size={13} />} loading={busy === `sub:${s.id}`} onClick={() => remove(s)} aria-label={`Remove ${s.email}`} />
            </div>
          ))}
        </Card>
      )}
    </>
  );
};

export default function Messages() {
  const [section, setSection] = useState<Section>('messages');
  const { newMessageCount } = useAdmin();
  return (
    <>
      <PageHeader title="Messages & newsletter" subtitle="Contact-form messages from visitors, and the newsletter mailing list." />
      <Tabs<Section>
        value={section}
        onChange={setSection}
        items={[
          { id: 'messages', label: 'Contact messages', count: newMessageCount, alert: true },
          { id: 'newsletter', label: 'Newsletter subscribers' },
        ]}
      />
      {section === 'messages' ? <MessagesPane /> : <Newsletter />}
    </>
  );
}
