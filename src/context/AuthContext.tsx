import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ACCOUNT_BANNED_EVENT, AUTH_EXPIRED_EVENT } from '../lib/apiClient';
import { authClient, fetchAuthProviders } from '../lib/authClient';
import { REQUIRE_VERIFIED_EMAIL } from '../lib/config';
import { AuthServiceError, logError } from '../lib/errors';
import { cleanEmail, cleanText } from '../lib/security';
import {
  fetchMyProfile,
  removeMyAvatar,
  ServerUserProfile,
  updateMyAvatar,
  updateMyProfile,
} from '../services/profile';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  role?: 'user' | 'admin';
}

export interface UserProfile {
  id: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  createdAt: string;
}

export interface BanInfo {
  reason?: string;
}

export type AuthModalMode = 'signin' | 'signup' | 'forgot' | 'reset' | 'verify' | 'banned';

interface BetterAuthUserPayload {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  emailVerified?: boolean;
  role?: string | null;
  banned?: boolean | null;
  banReason?: string | null;
  createdAt?: string | Date;
}

interface AuthContextType {
  currentUser: AuthUser | null;
  userProfile: UserProfile | null;
  loading: boolean;

  isAdmin: boolean;
  ban: BanInfo | null;
  emailVerified: boolean;
  /** Signed in, not suspended, and (if required) email verified. */
  canPost: boolean;
  /** Email remembered in memory only while waiting for verification in the current session. */
  pendingVerificationEmail: string | null;
  /** Password reset token parsed from a verified email link. */
  resetToken: string | null;

  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, name?: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  confirmPasswordReset: (newPassword: string, token?: string) => Promise<void>;
  resendVerification: (emailOverride?: string) => Promise<void>;
  refreshVerification: () => Promise<boolean>;
  refreshRoles: () => Promise<void>;
  updateProfileName: (displayName: string) => Promise<void>;
  updateAvatar: (file: File) => Promise<string>;
  removeAvatar: () => Promise<void>;
  logout: () => Promise<void>;

  isAuthModalOpen: boolean;
  authModalMode: AuthModalMode;
  authNotice: string | null;
  openAuthModal: (mode?: AuthModalMode, notice?: string) => void;
  closeAuthModal: () => void;

  /**
   * Gate for member-only actions. Returns true if the user may proceed;
   * otherwise opens the right prompt (sign in / verify email / suspended).
   */
  requireMember: (what: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function toAuthUser(raw: BetterAuthUserPayload): AuthUser {
  const safePhoto =
    raw.image && (raw.image.startsWith('https://') || raw.image.startsWith('/api/media/'))
      ? raw.image.slice(0, 2000)
      : null;
  const fallbackName = raw.email ? raw.email.split('@')[0] : 'Naija Explorer';
  return {
    uid: raw.id,
    email: raw.email || null,
    displayName: cleanText(raw.name || fallbackName, 100) || null,
    photoURL: safePhoto,
    emailVerified: Boolean(raw.emailVerified),
    role: raw.role === 'admin' ? 'admin' : 'user',
  };
}

function toUserProfile(raw: BetterAuthUserPayload): UserProfile {
  const authUser = toAuthUser(raw);
  const created =
    raw.createdAt instanceof Date
      ? raw.createdAt.toISOString()
      : typeof raw.createdAt === 'string' && raw.createdAt
        ? raw.createdAt
        : new Date().toISOString();
  return {
    id: authUser.uid,
    email: authUser.email || '',
    displayName: authUser.displayName || 'Naija Explorer',
    photoURL: authUser.photoURL || '',
    createdAt: created,
  };
}

function toAuthServiceError(err: { code?: string; message?: string; status?: number } | null | undefined): AuthServiceError {
  if (!err) return new AuthServiceError('UNKNOWN_ERROR', 'Something went wrong. Please try again.');
  const code = err.code || (err.status === 429 ? 'TOO_MANY_REQUESTS' : err.status && err.status >= 500 ? 'AUTH_BACKEND_UNAVAILABLE' : 'AUTH_ERROR');
  return new AuthServiceError(code, err.message, err.status);
}

function buildCallbackUrl(params: Record<string, string>): string {
  if (typeof window === 'undefined') return 'http://localhost:3000/';
  const url = new URL(window.location.origin + '/');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ban, setBan] = useState<BanInfo | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>('signin');
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const seq = useRef(0);
  const currentUserRef = useRef<AuthUser | null>(null);
  currentUserRef.current = currentUser;

  const applyServerProfile = useCallback((profile: ServerUserProfile) => {
    const safePhoto =
      profile.photoURL &&
      (profile.photoURL.startsWith('https://') || profile.photoURL.startsWith('/api/media/'))
        ? profile.photoURL.slice(0, 2000)
        : null;
    const mapped: AuthUser = {
      uid: profile.id,
      email: profile.email || null,
      displayName: cleanText(profile.displayName, 100) || null,
      photoURL: safePhoto,
      emailVerified: Boolean(profile.emailVerified),
      role: profile.role === 'admin' ? 'admin' : 'user',
    };
    setCurrentUser(mapped);
    setUserProfile({
      id: profile.id,
      email: profile.email,
      displayName: profile.displayName,
      photoURL: safePhoto || '',
      createdAt: profile.createdAt,
    });
    setIsAdmin(profile.role === 'admin' && !profile.banned);
    setBan(profile.banned ? { reason: profile.banReason || undefined } : null);
    setEmailVerified(Boolean(profile.emailVerified));
    if (profile.emailVerified) {
      setPendingVerificationEmail(null);
    }
    return mapped;
  }, []);

  const applySessionPayload = useCallback((rawUser: BetterAuthUserPayload | null | undefined) => {
    if (!rawUser) {
      setCurrentUser(null);
      setUserProfile(null);
      setIsAdmin(false);
      setBan(null);
      setEmailVerified(false);
      return null;
    }
    const mapped = toAuthUser(rawUser);
    setCurrentUser(mapped);
    setUserProfile(toUserProfile(rawUser));
    setIsAdmin(rawUser.role === 'admin' && !rawUser.banned);
    setBan(rawUser.banned ? { reason: rawUser.banReason || undefined } : null);
    setEmailVerified(Boolean(rawUser.emailVerified));
    if (rawUser.emailVerified) {
      setPendingVerificationEmail(null);
    }
    return mapped;
  }, []);

  const syncSessionFromServer = useCallback(
    async (disableCookieCache = false): Promise<AuthUser | null> => {
      const mine = ++seq.current;
      try {
        const res = await authClient.getSession(
          disableCookieCache ? { query: { disableCookieCache: true } } : undefined,
        );
        if (mine !== seq.current) return null;
        if (res.error) {
          applySessionPayload(null);
          return null;
        }
        const sessionUser = (res.data as { user?: BetterAuthUserPayload } | null)?.user;
        if (!sessionUser) {
          return applySessionPayload(null);
        }
        const fallbackMapped = applySessionPayload(sessionUser);
        // Hydrate authoritative D1 profile row (role, banReason, avatar, displayName).
        try {
          const profile = await fetchMyProfile();
          if (mine !== seq.current) return null;
          return applyServerProfile(profile);
        } catch {
          return fallbackMapped;
        }
      } catch {
        // Worker unreachable in pure-Vite preview mode: leave unauthenticated without throwing.
        if (mine !== seq.current) return null;
        return applySessionPayload(null);
      } finally {
        if (mine === seq.current) {
          setLoading(false);
        }
      }
    },
    [applyServerProfile, applySessionPayload],
  );

  // Restore HTTP-only cookie session on mount & handle email/OAuth redirect query params.
  useEffect(() => {
    let cancelled = false;

    const handleInitialState = async () => {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const authAction = params.get('auth');
        const token = params.get('token');
        const errorParam = params.get('error');

        if (authAction || errorParam || token) {
          if (authAction === 'reset-password') {
            if (token) {
              setResetToken(token);
              setAuthModalMode('reset');
              setAuthNotice(null);
            } else {
              setResetToken(null);
              setAuthModalMode('forgot');
              setAuthNotice('That password reset link is invalid or has expired. Request a new one below.');
            }
            setIsAuthModalOpen(true);
          } else if (authAction === 'verified') {
            if (errorParam) {
              setAuthModalMode('verify');
              setAuthNotice('That verification link is invalid or expired. Request a fresh link below.');
              setIsAuthModalOpen(true);
            } else {
              const verifiedUser = await syncSessionFromServer(true);
              if (cancelled) return;
              if (!verifiedUser) {
                setAuthModalMode('signin');
                setAuthNotice('Your email is verified. Sign in below to list businesses, post ads, and write reviews.');
                setIsAuthModalOpen(true);
              }
            }
          } else if (errorParam) {
            setAuthModalMode('signin');
            setAuthNotice(
              errorParam === 'account_not_linked'
                ? 'Could not link your Google account automatically. Sign in with your verified email first.'
                : 'Authentication could not be completed. Please try again.',
            );
            setIsAuthModalOpen(true);
          }

          // Clean one-time auth callback parameters from the address bar.
          params.delete('auth');
          params.delete('token');
          params.delete('error');
          const nextSearch = params.toString();
          const cleanedUrl =
            window.location.pathname + (nextSearch ? `?${nextSearch}` : '') + window.location.hash;
          window.history.replaceState({}, document.title, cleanedUrl);
        }
      }

      if (!cancelled) {
        await syncSessionFromServer(false);
      }
    };

    void handleInitialState();
    return () => {
      cancelled = true;
    };
  }, [syncSessionFromServer]);

  const openAuthModal = useCallback((mode: AuthModalMode = 'signin', notice?: string) => {
    setAuthModalMode(mode);
    setAuthNotice(notice ?? null);
    setIsAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setIsAuthModalOpen(false);
    setAuthNotice(null);
  }, []);

  // Gracefully recover when an authenticated request returns 401 (expired session) or 403 ACCOUNT_BANNED.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let handlingExpired = false;

    const onAuthExpired = () => {
      if (handlingExpired) return;
      const hadUser = Boolean(currentUserRef.current);
      handlingExpired = true;
      void syncSessionFromServer(true)
        .then((user) => {
          if (!user && hadUser) {
            openAuthModal('signin', 'Your session expired. Please sign in again to continue.');
          }
        })
        .finally(() => {
          handlingExpired = false;
        });
    };

    const onAccountBanned = () => {
      void syncSessionFromServer(true).then(() => {
        openAuthModal('banned');
      });
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
    window.addEventListener(ACCOUNT_BANNED_EVENT, onAccountBanned);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
      window.removeEventListener(ACCOUNT_BANNED_EVENT, onAccountBanned);
    };
  }, [syncSessionFromServer, openAuthModal]);

  const signInWithGoogle = async () => {
    try {
      const providers = await fetchAuthProviders();
      if (!providers.google) {
        throw new AuthServiceError(
          'GOOGLE_OAUTH_NOT_CONFIGURED',
          'Google sign-in is not configured on this server yet.',
        );
      }
    } catch (err) {
      if (err instanceof AuthServiceError) throw err;
      throw new AuthServiceError('AUTH_BACKEND_UNAVAILABLE', 'Authentication server is unavailable.');
    }

    const callbackURL = typeof window !== 'undefined' ? window.location.href : '/';
    const errorCallbackURL = buildCallbackUrl({ auth: 'oauth-error' });

    const res = await authClient.signIn.social({
      provider: 'google',
      callbackURL,
      errorCallbackURL,
    });
    if (res.error) {
      throw toAuthServiceError(res.error);
    }
  };

  const signInWithEmail = async (email: string, pass: string) => {
    const cleaned = cleanEmail(email);
    if (!cleaned) {
      throw new AuthServiceError('INVALID_EMAIL', 'Please enter a valid email address.');
    }
    let res;
    try {
      res = await authClient.signIn.email({
        email: cleaned,
        password: pass,
      });
    } catch (err) {
      logError('email sign in', err);
      throw new AuthServiceError('AUTH_BACKEND_UNAVAILABLE', 'Authentication server is unavailable.');
    }

    if (res.error) {
      if (res.error.code === 'EMAIL_NOT_VERIFIED') {
        setPendingVerificationEmail(cleaned);
        setAuthModalMode('verify');
        setAuthNotice('Your email is not verified yet. Check your inbox or click resend below.');
        setIsAuthModalOpen(true);
        return;
      }
      throw toAuthServiceError(res.error);
    }

    const user = await syncSessionFromServer(true);
    if (user && !user.emailVerified && REQUIRE_VERIFIED_EMAIL) {
      setPendingVerificationEmail(cleaned);
      setAuthModalMode('verify');
      setAuthNotice('Please verify your email address to unlock posting and reviews.');
      return;
    }

    setIsAuthModalOpen(false);
    setAuthNotice(null);
  };

  const signUpWithEmail = async (email: string, pass: string, name?: string) => {
    const cleaned = cleanEmail(email);
    if (!cleaned) {
      throw new AuthServiceError('INVALID_EMAIL', 'Please enter a valid email address.');
    }
    const cleanName = cleanText(name ?? '', 100) || cleaned.split('@')[0] || 'Naija Explorer';

    let res;
    try {
      res = await authClient.signUp.email({
        email: cleaned,
        password: pass,
        name: cleanName,
        callbackURL: buildCallbackUrl({ auth: 'verified' }),
      });
    } catch (err) {
      logError('email sign up', err);
      throw new AuthServiceError('AUTH_BACKEND_UNAVAILABLE', 'Authentication server is unavailable.');
    }

    if (res.error) {
      throw toAuthServiceError(res.error);
    }

    setPendingVerificationEmail(cleaned);
    await syncSessionFromServer(true);
    setAuthModalMode('verify');
    setAuthNotice(null);
  };

  const resetPassword = async (email: string) => {
    const cleaned = cleanEmail(email);
    if (!cleaned) {
      throw new AuthServiceError('INVALID_EMAIL', 'Please enter a valid email address.');
    }
    let res;
    try {
      res = await authClient.requestPasswordReset({
        email: cleaned,
        redirectTo: buildCallbackUrl({ auth: 'reset-password' }),
      });
    } catch (err) {
      logError('password reset request', err);
      throw new AuthServiceError('AUTH_BACKEND_UNAVAILABLE', 'Authentication server is unavailable.');
    }
    if (res.error) {
      throw toAuthServiceError(res.error);
    }
  };

  const confirmPasswordReset = async (newPassword: string, tokenOverride?: string) => {
    const token = tokenOverride || resetToken;
    if (!token) {
      throw new AuthServiceError('INVALID_TOKEN', 'Missing password reset token.');
    }
    let res;
    try {
      res = await authClient.resetPassword({
        newPassword,
        token,
      });
    } catch (err) {
      logError('password reset confirm', err);
      throw new AuthServiceError('AUTH_BACKEND_UNAVAILABLE', 'Authentication server is unavailable.');
    }
    if (res.error) {
      throw toAuthServiceError(res.error);
    }
    setResetToken(null);
  };

  const resendVerification = async (emailOverride?: string) => {
    const targetEmail = cleanEmail(emailOverride || currentUser?.email || pendingVerificationEmail || '');
    if (!targetEmail) {
      throw new AuthServiceError('INVALID_EMAIL', 'Sign in or enter your email address first.');
    }
    let res;
    try {
      res = await authClient.sendVerificationEmail({
        email: targetEmail,
        callbackURL: buildCallbackUrl({ auth: 'verified' }),
      });
    } catch (err) {
      logError('resend verification', err);
      throw new AuthServiceError('AUTH_BACKEND_UNAVAILABLE', 'Authentication server is unavailable.');
    }
    if (res.error) {
      throw toAuthServiceError(res.error);
    }
  };

  const refreshVerification = async () => {
    const user = await syncSessionFromServer(true);
    return Boolean(user?.emailVerified);
  };

  const refreshRoles = async () => {
    await syncSessionFromServer(true);
  };

  const updateProfileName = async (displayName: string): Promise<void> => {
    if (!currentUser) {
      throw new AuthServiceError('UNAUTHORIZED', 'Sign in first to update your profile.');
    }
    const updated = await updateMyProfile(displayName);
    applyServerProfile(updated);
  };

  const updateAvatar = async (file: File): Promise<string> => {
    if (!currentUser) {
      throw new AuthServiceError('UNAUTHORIZED', 'Sign in first to update your profile photo.');
    }
    const nextUrl = await updateMyAvatar(currentUser.uid, file);
    await syncSessionFromServer(true);
    return nextUrl;
  };

  const removeAvatar = async (): Promise<void> => {
    if (!currentUser) return;
    await removeMyAvatar();
    await syncSessionFromServer(true);
  };

  const logout = async () => {
    try {
      await authClient.signOut();
    } catch (err) {
      logError('sign out', err);
    }
    setPendingVerificationEmail(null);
    applySessionPayload(null);
  };

  const canPost = !!currentUser && !ban && (!REQUIRE_VERIFIED_EMAIL || emailVerified);

  const requireMember = useCallback(
    (what: string) => {
      if (!currentUser) {
        openAuthModal('signin', `Sign in or create a free account to ${what}.`);
        return false;
      }
      if (ban) {
        openAuthModal('banned');
        return false;
      }
      if (REQUIRE_VERIFIED_EMAIL && !emailVerified) {
        openAuthModal('verify', `Please verify your email address to ${what}.`);
        return false;
      }
      return true;
    },
    [currentUser, ban, emailVerified, openAuthModal],
  );

  const value = useMemo<AuthContextType>(
    () => ({
      currentUser,
      userProfile,
      loading,
      isAdmin,
      ban,
      emailVerified,
      canPost,
      pendingVerificationEmail,
      resetToken,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      resetPassword,
      confirmPasswordReset,
      resendVerification,
      refreshVerification,
      refreshRoles,
      updateProfileName,
      updateAvatar,
      removeAvatar,
      logout,
      isAuthModalOpen,
      authModalMode,
      authNotice,
      openAuthModal,
      closeAuthModal,
      requireMember,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      currentUser,
      userProfile,
      loading,
      isAdmin,
      ban,
      emailVerified,
      canPost,
      pendingVerificationEmail,
      resetToken,
      isAuthModalOpen,
      authModalMode,
      authNotice,
      openAuthModal,
      closeAuthModal,
      requireMember,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
