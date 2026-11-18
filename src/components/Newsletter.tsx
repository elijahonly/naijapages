import React, { useState } from 'react';
import { Mail, CheckCircle2, AlertCircle, Loader2, Sparkles, Send, ShieldCheck, Newspaper } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { subscribeNewsletter, ValidationError } from '../services/content';
import { friendlyError, logError } from '../lib/errors';
import { cooldownRemaining, startCooldown } from '../lib/security';

export const Newsletter: React.FC = () => {
  const { currentUser } = useAuth();
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('All Sectors');
  const [loading, setLoading] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Hidden "website" field: real visitors never see or fill it, bots usually do.
    if (honeypot) {
      setSubscribed(true);
      return;
    }
    if (cooldownRemaining('newsletter', 15_000) > 0) {
      setError('Please wait a few seconds before trying again.');
      return;
    }

    setLoading(true);
    try {
      await subscribeNewsletter(email, category !== 'All Sectors' ? `sector_${category.toLowerCase()}` : 'homepage_banner');
      startCooldown('newsletter');
      setSubscribed(true);
      setEmail('');
    } catch (err) {
      logError('newsletter subscribe', err);
      setError(
        err instanceof ValidationError ? err.message : friendlyError(err, 'Subscription temporarily unavailable. Please try again shortly.'),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-emerald-900 via-teal-900 to-slate-900 text-white py-14 px-4 sm:px-6 lg:px-8 rounded-3xl my-10 shadow-xl border border-emerald-800/40">
      {/* Background radial glow */}
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-80 h-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-80 h-80 rounded-full bg-teal-500/10 blur-3xl pointer-events-none"></div>

      <div className="relative max-w-4xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-800/60 border border-emerald-600/40 text-emerald-300 text-xs font-semibold mb-4 backdrop-blur-sm">
          <Newspaper size={14} className="text-emerald-400" />
          <span>Nigeria Business Weekly Digest</span>
        </div>

        <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-white mb-3">
          Stay Ahead with Verified Nigerian Market Insights
        </h2>

        <p className="text-sm sm:text-base text-emerald-100/90 max-w-2xl mx-auto mb-8 font-light leading-relaxed">
          Get weekly reports on vetted businesses, regulatory compliance (CAC, NAFDAC, SON), local supply chains, and emerging commercial hubs across Lagos, Abuja, Kano, Port Harcourt, and all 36 States.
        </p>

        {subscribed ? (
          <div className="max-w-md mx-auto p-6 bg-emerald-800/60 border border-emerald-500/40 rounded-2xl backdrop-blur-md animate-fade-in text-center">
            <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-3 text-emerald-400">
              <CheckCircle2 size={28} />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">E kaabo! You're Subscribed!</h3>
            <p className="text-xs text-emerald-200">
              We've added you to our weekly Nigeria business briefing. You'll receive the next edition directly in your inbox.
            </p>
            <button
              onClick={() => setSubscribed(false)}
              className="mt-4 text-xs text-emerald-300 hover:text-white underline underline-offset-4 font-medium"
            >
              Subscribe another email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="max-w-xl mx-auto space-y-3">
            {/* Anti-bot trap: hidden from people and screen readers */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              className="absolute -left-[9999px] w-px h-px opacity-0"
            />
            {error && (
              <div className="p-3 bg-rose-950/80 border border-rose-500/40 rounded-xl text-rose-200 text-xs flex items-center justify-center gap-2">
                <AlertCircle size={15} className="shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 bg-white/10 p-1.5 rounded-2xl border border-white/15 backdrop-blur-md">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-emerald-300">
                  <Mail size={18} />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={currentUser?.email || "Enter your business email"}
                  required
                  className="w-full pl-10 pr-3 py-3 bg-transparent text-white placeholder-emerald-200/60 text-sm focus:outline-none"
                />
              </div>

              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="bg-emerald-950/70 text-emerald-200 text-xs px-3 py-2 rounded-xl border border-emerald-700/50 focus:outline-none cursor-pointer"
              >
                <option value="All Sectors">All Sectors</option>
                <option value="Tech & Fintech">Tech & Fintech</option>
                <option value="Agriculture & Food">Agric & Food</option>
                <option value="Manufacturing">Manufacturing</option>
                <option value="Retail & Trade">Retail & Trade</option>
              </select>

              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-bold rounded-xl text-sm transition-all shadow-lg hover:shadow-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin text-slate-900" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <span>Subscribe</span>
                    <Send size={15} />
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center justify-center gap-4 text-xs text-emerald-300/80 pt-2 font-light">
              <span className="flex items-center gap-1">
                <ShieldCheck size={14} className="text-emerald-400" /> No spam guaranteed
              </span>
              <span>•</span>
              <span>Every Thursday morning</span>
              <span>•</span>
              <span>One-click unsubscribe</span>
            </div>
          </form>
        )}
      </div>
    </section>
  );
};
