import React, { useEffect, useState } from 'react';
import { Megaphone, Save, ShieldCheck, Phone, FileText } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../../lib/config';
import { SiteSettings } from '../../types';
import { fetchAdminSettings, saveSettings } from '../api';
import { useAdmin } from '../AdminContext';
import { useRunner } from '../useRunner';
import { Btn, Card, Field, PageHeader, Spinner, Toggle, inputCls } from '../ui';

const Section: React.FC<{ icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }> = ({ icon, title, hint, children }) => (
  <Card className="p-5">
    <div className="flex items-start gap-3 mb-4">
      <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">{icon}</div>
      <div>
        <h2 className="font-extrabold text-slate-900 dark:text-white">{title}</h2>
        {hint && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{hint}</p>}
      </div>
    </div>
    <div className="space-y-4">{children}</div>
  </Card>
);

export default function SettingsPage() {
  const { admin } = useAdmin();
  const { busy, run } = useRunner();
  const [form, setForm] = useState<SiteSettings | null>(null);
  const [dirty, setDirty] = useState(false);

  // Load the current settings once (so edits in progress aren't overwritten by refreshes).
  useEffect(() => {
    let alive = true;
    fetchAdminSettings()
      .then((s) => {
        if (alive) setForm((current) => current ?? s);
      })
      .catch(() => {
        if (alive) setForm((current) => current ?? { ...DEFAULT_SETTINGS });
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!form) return <Spinner />;

  const set = <K extends keyof SiteSettings>(k: K, v: SiteSettings[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setDirty(true);
  };

  const onText = (k: keyof SiteSettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value as never);

  const save = async () => {
    if (await run('settings', () => saveSettings(admin, form), 'Settings saved. Changes are live.')) setDirty(false);
  };

  return (
    <>
      <PageHeader
        title="Site settings"
        subtitle="Edit the contact details, About page text, site-wide announcement and posting rules without touching any code."
        actions={<Btn variant="primary" size="md" icon={<Save size={14} />} loading={busy === 'settings'} disabled={!dirty} onClick={save}>Save changes</Btn>}
      />

      <div className="space-y-5 max-w-3xl">
        <Section icon={<Phone size={18} />} title="Contact details" hint="Shown on the Contact page and in the site footer. Leave a field empty to hide it.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Public email" htmlFor="s-email"><input id="s-email" type="email" className={inputCls} maxLength={150} placeholder="hello@yourdomain.ng" value={form.contactEmail} onChange={onText('contactEmail')} /></Field>
            <Field label="Phone number" htmlFor="s-phone"><input id="s-phone" className={inputCls} maxLength={40} placeholder="+234 800 000 0000" value={form.contactPhone} onChange={onText('contactPhone')} /></Field>
            <Field label="WhatsApp number" htmlFor="s-wa" hint="Include the country code, e.g. 2348012345678"><input id="s-wa" className={inputCls} maxLength={40} placeholder="2348012345678" value={form.whatsapp} onChange={onText('whatsapp')} /></Field>
            <Field label="Office hours" htmlFor="s-hours"><input id="s-hours" className={inputCls} maxLength={200} placeholder="Mon–Fri, 9am–5pm (WAT)" value={form.officeHours} onChange={onText('officeHours')} /></Field>
            <div className="sm:col-span-2"><Field label="Address" htmlFor="s-addr"><textarea id="s-addr" rows={2} className={inputCls} maxLength={300} placeholder="Office address (optional)" value={form.address} onChange={onText('address')} /></Field></div>
          </div>
        </Section>

        <Section icon={<FileText size={18} />} title="About page" hint="The “What NaijaPages is about” section. Separate paragraphs with a blank line. Leave empty to use the default text.">
          <Field label="Our story" htmlFor="s-story">
            <textarea id="s-story" rows={8} className={inputCls} maxLength={5000} value={form.aboutStory} onChange={onText('aboutStory')} placeholder="Write a few paragraphs about your mission and how NaijaPages started…" />
            <p className="text-[11px] text-slate-400 text-right mt-1">{form.aboutStory.length}/5000</p>
          </Field>
        </Section>

        <Section icon={<Megaphone size={18} />} title="Announcement bar" hint="A highlighted strip across the top of every page. Visitors can dismiss it.">
          <Toggle checked={form.announcementEnabled} onChange={(v) => set('announcementEnabled', v)} label="Show the announcement" />
          <Field label="Message" htmlFor="s-ann"><input id="s-ann" className={inputCls} maxLength={300} placeholder="e.g. 🎉 New: list your business for free this month!" value={form.announcementText} onChange={onText('announcementText')} /></Field>
          {form.announcementEnabled && form.announcementText.trim() && (
            <div className="bg-amber-400 text-slate-950 text-xs font-semibold px-4 py-2 rounded-lg text-center">{form.announcementText}</div>
          )}
        </Section>

        <Section icon={<ShieldCheck size={18} />} title="Posting rules" hint="Business listings always wait for your approval. This switch controls Marketplace ads.">
          <Toggle
            checked={form.adsNeedApproval}
            onChange={(v) => set('adsNeedApproval', v)}
            label="Marketplace ads need approval before going live"
            description="Off: ads appear immediately and you remove bad ones afterwards. On: every new ad waits in the Marketplace → Pending tab until you approve it."
          />
        </Section>
      </div>
    </>
  );
}
