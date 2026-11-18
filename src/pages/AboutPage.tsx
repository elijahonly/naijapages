import React from 'react';
import {
  Building2,
  ShoppingBag,
  ShieldCheck,
  Search,
  MessageCircle,
  UserCheck,
  ClipboardCheck,
  Flag,
  Rocket,
  ArrowRight,
  MapPin,
  Tag,
  Store,
  Mail,
} from 'lucide-react';
import { SiteSettings } from '../types';

interface AboutPageProps {
  settings: SiteSettings;
  stats: { listings: number; ads: number; states: number; categories: number };
  onAddBusiness: () => void;
}

const DEFAULT_STORY = [
  'NaijaPages brings Nigeria’s businesses and everyday buyers and sellers together in one place. Whether you’re looking for a trusted mechanic in Enugu, a caterer in Abuja, or a second-hand phone in Lagos, our goal is simple: make it quick to find the right people and easy to contact them directly.',
  'We cover all 36 States and the Federal Capital Territory, and we built the platform around how Nigerians actually do business: a phone call, a WhatsApp message, and clear directions to the shop.',
];

export const AboutPage: React.FC<AboutPageProps> = ({ settings, stats, onAddBusiness }) => {
  const story = settings.aboutStory.trim() ? settings.aboutStory.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) : DEFAULT_STORY;

  const statItems = [
    { icon: <Building2 className="w-5 h-5" />, value: stats.listings.toLocaleString(), label: 'Business listings' },
    { icon: <MapPin className="w-5 h-5" />, value: String(stats.states), label: 'States & the FCT' },
    { icon: <ShoppingBag className="w-5 h-5" />, value: stats.ads.toLocaleString(), label: 'Marketplace ads' },
    { icon: <Tag className="w-5 h-5" />, value: String(stats.categories), label: 'Business categories' },
  ];

  const doItems = [
    {
      icon: <Search className="w-6 h-6" />,
      title: 'Find a business you can trust',
      body: 'Search by state, local government area or category. See opening hours and reviews, then call, WhatsApp or get directions in one tap.',
    },
    {
      icon: <ShoppingBag className="w-6 h-6" />,
      title: 'Buy and sell on the Marketplace',
      body: 'Browse ads for phones, vehicles, property, fashion and more, or post your own. Buyers and sellers talk directly, with no middleman.',
    },
    {
      icon: <Store className="w-6 h-6" />,
      title: 'Get your business found',
      body: 'List your business so customers in your area can discover you, and claim your listing to earn the verified badge once we’ve checked your details.',
    },
  ];

  const trustItems = [
    { icon: <ClipboardCheck className="w-5 h-5" />, title: 'Reviewed before they go live', body: 'New business listings are checked by our team before they appear in the directory.' },
    { icon: <ShieldCheck className="w-5 h-5" />, title: 'Verified means checked', body: 'The Verified badge is awarded by our team after reviewing a business’s details. It can’t be self-declared.' },
    { icon: <UserCheck className="w-5 h-5" />, title: 'Registered members only', body: 'You need an account with a verified email to list a business, post an ad or write a review, which keeps out anonymous spam.' },
    { icon: <Flag className="w-5 h-5" />, title: 'Report and removal', body: 'Every listing and ad has a Report button. We review reports, remove content that breaks the rules and suspend repeat offenders.' },
  ];

  const steps = [
    { n: 1, title: 'Create a free account', body: 'Sign up with Google or email, and verify your address.' },
    { n: 2, title: 'Submit your details', body: 'Add your business information, location and contact numbers.' },
    { n: 3, title: 'We review it', body: 'Our team checks the listing. Track its status under My Submissions.' },
    { n: 4, title: 'Go live and get found', body: 'Once approved, customers can find you, call you and review you.' },
  ];

  return (
    <main className="w-full flex-1">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-900 text-white">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-emerald-400/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-16 w-80 h-80 rounded-full bg-amber-400/10 blur-3xl pointer-events-none" />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20 text-center">
          <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider bg-emerald-950/60 border border-emerald-600/40 text-emerald-200 px-3 py-1 rounded-full">
            🇳🇬 About NaijaPages
          </span>
          <h1 className="mt-5 text-3xl sm:text-5xl font-black tracking-tight leading-tight">
            Nigeria’s businesses, <span className="text-amber-300">one call away.</span>
          </h1>
          <p className="mt-4 text-sm sm:text-lg text-emerald-100/90 max-w-2xl mx-auto leading-relaxed">
            A business directory and marketplace built so that finding a trusted business, or selling something, takes a phone call or a WhatsApp message.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <a href="#/" className="inline-flex items-center gap-2 bg-white text-emerald-900 font-bold text-sm px-5 py-2.5 rounded-xl shadow hover:bg-emerald-50 transition">
              Browse the directory <ArrowRight size={16} />
            </a>
            <button type="button" onClick={onAddBusiness} className="inline-flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-sm px-5 py-2.5 rounded-xl shadow transition cursor-pointer">
              List your business
            </button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section aria-label="NaijaPages in numbers" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 relative z-10">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
          {statItems.map((s) => (
            <div key={s.label} className="flex items-center gap-3 p-2">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">{s.icon}</div>
              <div>
                <dd className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white leading-none">{s.value}</dd>
                <dt className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1">{s.label}</dt>
              </div>
            </div>
          ))}
        </dl>
      </section>

      {/* Our story */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">What NaijaPages is about</h2>
        <div className="mt-4 space-y-4 text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
          {story.map((p, i) => (
            <p key={i} className="whitespace-pre-line">{p}</p>
          ))}
        </div>
      </section>

      {/* What you can do */}
      <section className="bg-white dark:bg-slate-900 border-y border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight text-center">What you can do here</h2>
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-5">
            {doItems.map((d) => (
              <article key={d.title} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-6 hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/20">{d.icon}</div>
                <h3 className="mt-4 font-extrabold text-slate-900 dark:text-white">{d.title}</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{d.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Trust & safety */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">How we keep the platform trustworthy</h2>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">A directory is only useful if you can rely on it. These are the checks built into NaijaPages.</p>
        </div>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {trustItems.map((t) => (
            <div key={t.title} className="flex gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">{t.icon}</div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">{t.title}</h3>
                <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400 leading-relaxed">{t.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How listing works */}
      <section className="bg-gradient-to-br from-emerald-950 via-slate-900 to-emerald-900 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <div className="flex items-center justify-center gap-2 text-amber-300 text-xs font-bold uppercase tracking-wider"><Rocket size={14} /> For business owners</div>
          <h2 className="mt-2 text-2xl sm:text-3xl font-black tracking-tight text-center">List your business in four steps</h2>
          <ol className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {steps.map((s) => (
              <li key={s.n} className="rounded-2xl bg-white/5 border border-white/10 p-5">
                <div className="w-9 h-9 rounded-full bg-amber-400 text-slate-950 font-black flex items-center justify-center">{s.n}</div>
                <h3 className="mt-3 font-bold">{s.title}</h3>
                <p className="mt-1 text-[13px] text-emerald-100/80 leading-relaxed">{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-8 text-center">
            <button type="button" onClick={onAddBusiness} className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm px-6 py-3 rounded-xl shadow-lg transition cursor-pointer">
              Start your listing <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>

      {/* Contact CTA */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-14 text-center">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 flex items-center justify-center"><MessageCircle size={24} /></div>
        <h2 className="mt-4 text-xl sm:text-2xl font-black text-slate-900 dark:text-white">Questions, feedback or a problem to report?</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">We’d love to hear from you.</p>
        <a href="#/contact" className="mt-5 inline-flex items-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-sm px-5 py-2.5 rounded-xl hover:opacity-90 transition">
          <Mail size={16} /> Contact us
        </a>
      </section>
    </main>
  );
};
