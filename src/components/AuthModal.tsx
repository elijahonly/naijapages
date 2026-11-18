import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useModal } from '../hooks/useModal';
import { cleanEmail, cooldownRemaining, passwordProblem, startCooldown } from '../lib/security';
import { navigate } from '../lib/router';
import { authErrorMessage } from '../lib/errors';
import {
  X,
  Mail,
  Lock,
  User as UserIcon,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Eye,
  EyeOff,
  Info,
  MailCheck,
  Ban,
} from 'lucide-react';

const inputCls =
  'w-full pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 rounded-xl focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition-colors';
const labelCls = 'block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5';

const AuthDialog: React.FC = () => {
  const {
    currentUser,
    ban,
    closeAuthModal,
    authModalMode,
    authNotice,
    openAuthModal,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    resetPassword,
    resendVerification,
    refreshVerification,
    logout,
  } = useAuth();
  useModal(closeAuthModal);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [, tick] = useState(0);

  const mode = authModalMode;
  const isSignUp = mode === 'signup';

  // Clear messages when switching between views.
  useEffect(() => {
    setError(null);
    setInfo(null);
  }, [mode]);

  // Re-render once a second while the "resend" cooldown is running.
  useEffect(() => {
    if (mode !== 'verify') return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [mode]);

  const resendWait = Math.ceil(cooldownRemaining('verify-email', 60_000) / 1000);

  const handleGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanedEmail = cleanEmail(email);
    if (!cleanedEmail || !password) {
      setError('Please enter a valid email address and password.');
      return;
    }
    if (isSignUp) {
      const problem = passwordProblem(password);
      if (problem) return setError(problem);
      if (password !== confirmPassword) return setError('Passwords do not match.');
    }

    setSubmitting(true);
    try {
      if (isSignUp) await signUpWithEmail(cleanedEmail, password, name);
      else await signInWithEmail(cleanedEmail, password);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanedEmail = cleanEmail(email);
    if (!cleanedEmail) return setError('Please enter the email address you signed up with.');
    setSubmitting(true);
    try {
      await resetPassword(cleanedEmail);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      // Don't reveal whether an address has an account.
      if (code !== 'auth/user-not-found') {
        setError(authErrorMessage(err));
        setSubmitting(false);
        return;
      }
    }
    setInfo('If an account exists for that email, a password reset link is on its way. Check your inbox (and spam folder).');
    setSubmitting(false);
  };

  const handleResend = async () => {
    setError(null);
    setInfo(null);
    if (cooldownRemaining('verify-email', 60_000) > 0) return;
    setSubmitting(true);
    try {
      await resendVerification();
      startCooldown('verify-email');
      setInfo('Verification email sent. Check your inbox and spam folder.');
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerified = async () => {
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      const ok = await refreshVerification();
      if (ok) closeAuthModal();
      else setError("We can't see your verification yet. Click the link in the email first, then try again.");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const titles: Record<typeof mode, { title: string; sub: string }> = {
    signin: { title: 'Welcome back', sub: 'Sign in to list your business, post ads, and write reviews.' },
    signup: { title: 'Create your free account', sub: 'Join Nigeria’s business community. It takes under a minute.' },
    forgot: { title: 'Reset your password', sub: 'We’ll email you a link to choose a new one.' },
    verify: { title: 'Verify your email', sub: 'One quick step keeps NaijaPages free of spam and fake accounts.' },
    banned: { title: 'Account suspended', sub: 'Posting is switched off for this account.' },
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm overflow-y-auto"
      onClick={closeAuthModal}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-800 px-6 py-6 text-white relative">
          <button
            onClick={closeAuthModal}
            className="absolute top-4 right-4 p-1.5 text-white/80 hover:text-white rounded-full hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs uppercase tracking-wider font-semibold text-emerald-200">NaijaPages Member Portal</span>
          </div>
          <h2 id="auth-title" className="text-2xl font-bold tracking-tight">
            {titles[mode].title}
          </h2>
          <p className="text-xs text-emerald-100 mt-1">{titles[mode].sub}</p>
        </div>

        {/* Sign in / Create account tabs */}
        {(mode === 'signin' || mode === 'signup') && (
          <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
            {(['signin', 'signup'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => openAuthModal(m, authNotice ?? undefined)}
                className={`flex-1 py-3 text-sm font-semibold transition-colors text-center ${
                  mode === m
                    ? 'bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-400 border-b-2 border-emerald-600 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {m === 'signin' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>
        )}

        <div className="p-6">
          {authNotice && mode !== 'banned' && (
            <div className="mb-4 p-3 bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900 rounded-xl text-sky-800 dark:text-sky-300 text-xs flex items-start gap-2">
              <Info size={15} className="shrink-0 mt-0.5" />
              <span>{authNotice}</span>
            </div>
          )}
          {error && (
            <div role="alert" className="mb-4 p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2.5">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div className="leading-relaxed">{error}</div>
            </div>
          )}
          {info && (
            <div role="status" className="mb-4 p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-xl text-emerald-800 dark:text-emerald-300 text-xs flex items-start gap-2.5">
              <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
              <div className="leading-relaxed">{info}</div>
            </div>
          )}

          {/* ---- Sign in / sign up ---- */}
          {(mode === 'signin' || mode === 'signup') && (
            <>
              <button
                type="button"
                onClick={handleGoogle}
                disabled={googleLoading || submitting}
                className="w-full flex items-center justify-center gap-3 py-2.5 px-4 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-100 font-medium text-sm shadow-sm hover:shadow transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {googleLoading ? (
                  <Loader2 size={18} className="animate-spin text-emerald-600" />
                ) : (
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                  </svg>
                )}
                <span>Continue with Google</span>
              </button>

              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200 dark:border-slate-700" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white dark:bg-slate-900 px-2.5 text-slate-400 font-medium">Or continue with email</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                {isSignUp && (
                  <div>
                    <label className={labelCls} htmlFor="auth-name">Full name</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><UserIcon size={16} /></div>
                      <input id="auth-name" type="text" autoComplete="name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Adebayo Ogunlesi" className={inputCls} />
                    </div>
                  </div>
                )}

                <div>
                  <label className={labelCls} htmlFor="auth-email">Email address</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><Mail size={16} /></div>
                    <input id="auth-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className={inputCls} />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className={labelCls} htmlFor="auth-password">Password</label>
                    {!isSignUp && (
                      <button type="button" onClick={() => openAuthModal('forgot')} className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline mb-1.5">
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><Lock size={16} /></div>
                    <input
                      id="auth-password"
                      type={showPw ? 'text' : 'password'}
                      autoComplete={isSignUp ? 'new-password' : 'current-password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className={`${inputCls} pr-10`}
                    />
                    <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label={showPw ? 'Hide password' : 'Show password'}>
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {isSignUp && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">At least 8 characters, with letters and numbers.</p>}
                </div>

                {isSignUp && (
                  <div>
                    <label className={labelCls} htmlFor="auth-confirm">Confirm password</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><Lock size={16} /></div>
                      <input id="auth-confirm" type={showPw ? 'text' : 'password'} autoComplete="new-password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" className={inputCls} />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || googleLoading}
                  className="w-full mt-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold rounded-xl text-sm shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>{isSignUp ? 'Creating account…' : 'Signing in…'}</span>
                    </>
                  ) : (
                    <span>{isSignUp ? 'Create Account' : 'Sign In'}</span>
                  )}
                </button>
              </form>
            </>
          )}

          {/* ---- Forgot password ---- */}
          {mode === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-4" noValidate>
              <div>
                <label className={labelCls} htmlFor="forgot-email">Email address</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><Mail size={16} /></div>
                  <input id="forgot-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className={inputCls} />
                </div>
              </div>
              <button type="submit" disabled={submitting} className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-60">
                {submitting && <Loader2 size={16} className="animate-spin" />}
                <span>Send reset link</span>
              </button>
              <button type="button" onClick={() => openAuthModal('signin')} className="w-full text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white">
                ← Back to sign in
              </button>
            </form>
          )}

          {/* ---- Verify email ---- */}
          {mode === 'verify' && (
            <div className="space-y-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                <MailCheck size={28} />
              </div>
              {currentUser ? (
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  We sent a verification link to <b className="text-slate-900 dark:text-white break-all">{currentUser.email}</b>. Click it, then come back here.
                </p>
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-300">Please sign in first.</p>
              )}
              {currentUser && (
                <div className="space-y-2">
                  <button type="button" onClick={handleVerified} disabled={submitting} className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-60">
                    {submitting && <Loader2 size={16} className="animate-spin" />}
                    <span>I’ve verified my email</span>
                  </button>
                  <button type="button" onClick={handleResend} disabled={submitting || resendWait > 0} className="w-full py-2 px-4 text-xs font-bold text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-50">
                    {resendWait > 0 ? `Resend email (${resendWait}s)` : 'Resend verification email'}
                  </button>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Can’t find it? Check your spam or promotions folder.</p>
                  <button type="button" onClick={async () => { await logout(); closeAuthModal(); }} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white underline underline-offset-2">
                    Use a different account
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ---- Suspended ---- */}
          {mode === 'banned' && (
            <div className="space-y-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
                <Ban size={28} />
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                This account has been suspended and can’t list businesses, post ads, write reviews or send reports.
              </p>
              {ban?.reason && (
                <p className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-700 dark:text-slate-300 text-left">
                  <b>Reason given:</b> {ban.reason}
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  closeAuthModal();
                  navigate('/contact');
                }}
                className="w-full py-2.5 px-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold rounded-xl text-sm"
              >
                Contact us to appeal
              </button>
            </div>
          )}

          <div className="mt-5 text-center text-xs text-slate-400 flex items-center justify-center gap-1.5">
            <ShieldCheck size={14} className="text-emerald-600" />
            <span>Secured by Google Firebase Authentication</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const AuthModal: React.FC = () => {
  const { isAuthModalOpen } = useAuth();
  return isAuthModalOpen ? <AuthDialog /> : null;
};
