import React, { useEffect, useState } from 'react';
import {
  Mail,
  Phone,
  MessageCircle,
  MapPin,
  Clock,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  LifeBuoy,
} from 'lucide-react';
import { SiteSettings } from '../types';
import { useAuth } from '../context/AuthContext';
import { sendContactMessage, ValidationError } from '../services/content';
import { friendlyError, logError } from '../lib/errors';
import { cooldownRemaining, startCooldown } from '../lib/security';

interface ContactPageProps {
  settings: SiteSettings;
}

const TOPICS = [
  'General question',
  'Help with my listing',
  'Report a problem',
  'Account suspension appeal',
  'Advertising & partnerships',
  'Other',
] as const;

const FAQS: { q: string; a: string }[] = [
  {
    q: 'How do I list my business?',
    a: 'Create a free account and verify your email, then choose “List Business”. Fill in your details, including a Google Maps link, and submit. Our team reviews every new listing before it appears in the directory.',
  },
  {
    q: 'How can I see if my listing has been approved?',
    a: 'Open your account menu and choose “My Submissions”. You’ll see whether each listing, ad or claim is awaiting review, live, or not approved, along with any note from our team.',
  },
  {
    q: 'How do I get the Verified badge?',
    a: 'The badge is added by our team after we check your details, for example your CAC registration. If your business is already in the directory, open it and choose “Claim this listing”.',
  },
  {
    q: 'How do I post an ad on the Marketplace?',
    a: 'Sign in with a verified email and choose “Sell / Post Ad”. Depending on current settings, ads either go live straight away or are checked by our team first. You can follow the status under My Submissions.',
  },
  {
    q: 'How do I report a scam or wrong information?',
    a: 'Open the listing or ad and press “Report”. Tell us what’s wrong; the more detail, the faster we can act. Reports are confidential, and the owner isn’t told who reported them.',
  },
  {
    q: 'My account was suspended. What can I do?',
    a: 'Send us a message using this form, choose “Account suspension appeal” as the topic, and use the email address you registered with. We’ll review your case.',
  },
  {
    q: 'How do I remove my listing or ad?',
    a: 'Open your account menu, go to “My Submissions” and use the Delete button next to the item.',
  },
];

const fieldCls =
  'w-full px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-slate-900 dark:text-white transition';

export const ContactPage: React.FC<ContactPageProps> = ({ settings }) => {
  const { currentUser, userProfile } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState<(typeof TOPICS)[number]>(TOPICS[0]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Prefill from the signed-in account (only fills empty fields, so we never overwrite what someone typed).
  useEffect(() => {
    if (userProfile?.displayName) setName((n) => n || userProfile.displayName || '');
    if (currentUser?.email) setEmail((e) => e || currentUser.email || '');
  }, [currentUser, userProfile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setError(null);

    if (honeypot) {
      setSent(true); // bots get a fake success and nothing is saved
      return;
    }
    const wait = Math.ceil(cooldownRemaining('contact', 30_000) / 1000);
    if (wait > 0) {
      setError(`Please wait ${wait}s before sending another message.`);
      return;
    }

    setSending(true);
    try {
      await sendContactMessage(currentUser, {
        name,
        email,
        subject: `[${topic}] ${subject.trim()}`,
        message,
      });
      startCooldown('contact');
      setSent(true);
      setSubject('');
      setMessage('');
    } catch (err) {
      logError('contact submit', err);
      setError(err instanceof ValidationError ? err.message : friendlyError(err, 'We couldn’t send your message. Please try again.'));
    } finally {
      setSending(false);
    }
  };

  const whatsappDigits = settings.whatsapp.replace(/[^0-9]/g, '');
  const cards = [
    settings.contactEmail && {
      icon: <Mail size={18} />,
      label: 'Email',
      value: settings.contactEmail,
      href: `mailto:${settings.contactEmail}`,
    },
    settings.contactPhone && {
      icon: <Phone size={18} />,
      label: 'Phone',
      value: settings.contactPhone,
      href: `tel:${settings.contactPhone.replace(/\s+/g, '')}`,
    },
    whatsappDigits && {
      icon: <MessageCircle size={18} />,
      label: 'WhatsApp',
      value: settings.whatsapp,
      href: `https://wa.me/${whatsappDigits}`,
    },
    settings.address && { icon: <MapPin size={18} />, label: 'Address', value: settings.address },
    settings.officeHours && { icon: <Clock size={18} />, label: 'Hours', value: settings.officeHours },
  ].filter(Boolean) as { icon: React.ReactNode; label: string; value: string; href?: string }[];

  return (
    <main className="w-full flex-1">
      <section className="bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-900 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 text-center">
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight">Contact us</h1>
          <p className="mt-3 text-sm sm:text-base text-emerald-100/90 max-w-xl mx-auto">
            Questions about a listing, feedback, or something to report? Send us a message and we’ll get back to you by email.
          </p>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Form */}
        <section className="lg:col-span-3" aria-labelledby="contact-form-title">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 sm:p-7">
            <h2 id="contact-form-title" className="text-lg font-extrabold text-slate-900 dark:text-white">Send us a message</h2>

            {sent ? (
              <div className="py-10 text-center space-y-3">
                <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center">
                  <CheckCircle2 size={30} />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white text-lg">Message sent. Thank you!</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto">We’ve received your message and will reply to the email address you gave us.</p>
                <button type="button" onClick={() => setSent(false)} className="mt-2 text-sm font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer">
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
                {error && (
                  <div role="alert" className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                    <AlertCircle size={15} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Anti-bot trap: hidden from people and screen readers */}
                <input
                  type="text"
                  name="company"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                  className="absolute -left-[9999px] w-px h-px opacity-0"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="c-name" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Your name *</label>
                    <input id="c-name" type="text" required maxLength={100} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} />
                  </div>
                  <div>
                    <label htmlFor="c-email" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Email address *</label>
                    <input id="c-email" type="email" required maxLength={150} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={fieldCls} />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
                  <div className="sm:col-span-2">
                    <label htmlFor="c-topic" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Topic</label>
                    <select id="c-topic" value={topic} onChange={(e) => setTopic(e.target.value as (typeof TOPICS)[number])} className={fieldCls}>
                      {TOPICS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-3">
                    <label htmlFor="c-subject" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Subject *</label>
                    <input id="c-subject" type="text" required maxLength={120} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="A few words about your message" className={fieldCls} />
                  </div>
                </div>

                <div>
                  <label htmlFor="c-message" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Message *</label>
                  <textarea id="c-message" required rows={6} maxLength={3000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Tell us how we can help. If this is about a listing or ad, please include its name." className={fieldCls} />
                  <p className="mt-1 text-[11px] text-slate-400 text-right">{message.length}/3000</p>
                </div>

                <button type="submit" disabled={sending} className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-sm px-6 py-3 rounded-xl shadow-md transition cursor-pointer w-full sm:w-auto">
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  <span>{sending ? 'Sending…' : 'Send message'}</span>
                </button>
                <p className="text-[11px] text-slate-400">We use your details only to reply to your message.</p>
              </form>
            )}
          </div>
        </section>

        {/* Details */}
        <aside className="lg:col-span-2 space-y-4" aria-label="Contact details">
          {cards.length > 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-4">
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">Reach us directly</h2>
              {cards.map((c) => (
                <div key={c.label} className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">{c.icon}</div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{c.label}</p>
                    {c.href ? (
                      <a href={c.href} target={c.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="text-sm font-semibold text-slate-800 dark:text-slate-100 hover:text-emerald-600 break-words">
                        {c.value}
                      </a>
                    ) : (
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 whitespace-pre-line">{c.value}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5">
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">How to reach us</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">The quickest way is the form: it goes straight to our team and we’ll reply by email.</p>
            </div>
          )}

          <div className="bg-amber-50 dark:bg-amber-950/30 rounded-2xl border border-amber-200 dark:border-amber-900/50 p-5">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-bold text-sm"><LifeBuoy size={16} /> Reporting a listing or ad?</div>
            <p className="mt-2 text-[13px] text-amber-900/80 dark:text-amber-200/80 leading-relaxed">
              The fastest way is the <b>Report</b> button on the listing or ad itself. It goes straight to our moderation queue.
            </p>
          </div>
        </aside>
      </div>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pb-6" aria-labelledby="faq-title">
        <h2 id="faq-title" className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight text-center">Frequently asked questions</h2>
        <div className="mt-6 space-y-2.5">
          {FAQS.map((f, i) => {
            const open = openFaq === i;
            return (
              <div key={f.q} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <h3>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`faq-panel-${i}`}
                    onClick={() => setOpenFaq(open ? null : i)}
                    className="w-full flex items-center justify-between gap-3 text-left px-4 py-3.5 font-bold text-sm text-slate-900 dark:text-white cursor-pointer"
                  >
                    <span>{f.q}</span>
                    <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                </h3>
                {open && (
                  <div id={`faq-panel-${i}`} className="px-4 pb-4 text-[13px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    {f.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
};
