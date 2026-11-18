import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  reload,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase';
import { COL, REQUIRE_VERIFIED_EMAIL } from '../lib/config';
import { cleanText } from '../lib/security';
import { logError } from '../lib/errors';

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

export type AuthModalMode = 'signin' | 'signup' | 'forgot' | 'verify' | 'banned';

interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  loading: boolean;

  /** Role flags are read from Firestore (UX only — firestore.rules is what actually enforces them). */
  isAdmin: boolean;
  ban: BanInfo | null;
  emailVerified: boolean;
  /** Signed in, not suspended, and (if required) email verified. */
  canPost: boolean;

  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, name?: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  /** Re-checks the verified flag after the user clicked the link in their email. */
  refreshVerification: () => Promise<boolean>;
  /** Re-reads the admin / suspended flags (used by the admin gate after the first admin record is created). */
  refreshRoles: () => Promise<void>;
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

function displayNameFor(user: User, fallback: string): string {
  return cleanText(user.displayName || user.email?.split('@')[0] || fallback, 100);
}

// A name typed on the sign-up form, used when the profile document is first created
// (onAuthStateChanged can fire before updateProfile() has finished).
let pendingSignupName: string | null = null;

async function ensureProfile(user: User): Promise<UserProfile> {
  const ref = doc(db, COL.users, user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data() as UserProfile;

    const photo = user.photoURL && user.photoURL.startsWith('https://') ? user.photoURL.slice(0, 2000) : '';
    const fresh: UserProfile = {
      id: user.uid,
      email: user.email || '',
      displayName: pendingSignupName || displayNameFor(user, 'Naija Explorer'),
      photoURL: photo,
      createdAt: new Date().toISOString(),
    };
    pendingSignupName = null;
    await setDoc(ref, fresh);
    return fresh;
  } catch (err) {
    logError('profile sync', err);
    return {
      id: user.uid,
      email: user.email || '',
      displayName: displayNameFor(user, 'User'),
      photoURL: '',
      createdAt: new Date().toISOString(),
    };
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ban, setBan] = useState<BanInfo | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>('signin');
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const seq = useRef(0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const mine = ++seq.current;
      setCurrentUser(user);

      if (!user) {
        setUserProfile(null);
        setIsAdmin(false);
        setBan(null);
        setEmailVerified(false);
        setLoading(false);
        return;
      }

      setEmailVerified(user.emailVerified);

      const [profile, adminSnap, banSnap] = await Promise.allSettled([
        ensureProfile(user),
        getDoc(doc(db, COL.admins, user.uid)),
        getDoc(doc(db, COL.bans, user.uid)),
      ]);
      if (mine !== seq.current) return; // a newer sign-in/out superseded this one

      if (profile.status === 'fulfilled') setUserProfile(profile.value);
      setIsAdmin(adminSnap.status === 'fulfilled' && adminSnap.value.exists());
      if (banSnap.status === 'fulfilled' && banSnap.value.exists()) {
        const data = banSnap.value.data() as { reason?: string };
        setBan({ reason: data.reason });
      } else {
        setBan(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const openAuthModal = useCallback((mode: AuthModalMode = 'signin', notice?: string) => {
    setAuthModalMode(mode);
    setAuthNotice(notice ?? null);
    setIsAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setIsAuthModalOpen(false);
    setAuthNotice(null);
  }, []);

  const signInWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
    setIsAuthModalOpen(false);
  };

  const signInWithEmail = async (email: string, pass: string) => {
    await signInWithEmailAndPassword(auth, email, pass);
    setIsAuthModalOpen(false);
  };

  const signUpWithEmail = async (email: string, pass: string, name?: string) => {
    const cleanName = cleanText(name ?? '', 100);
    pendingSignupName = cleanName || null;
    const credential = await createUserWithEmailAndPassword(auth, email, pass);
    if (cleanName) {
      try {
        await updateProfile(credential.user, { displayName: cleanName });
      } catch (err) {
        logError('update display name', err);
      }
    }
    try {
      await sendEmailVerification(credential.user);
    } catch (err) {
      logError('send verification', err); // non-fatal: the user can resend from the banner
    }
    // Move straight to the "check your inbox" step instead of closing the dialog.
    setAuthModalMode('verify');
    setAuthNotice(null);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  const resendVerification = async () => {
    if (!auth.currentUser) return;
    await sendEmailVerification(auth.currentUser);
  };

  const refreshVerification = async () => {
    const user = auth.currentUser;
    if (!user) return false;
    await reload(user);
    await user.getIdToken(true); // refresh the token so Firestore rules see email_verified = true
    setEmailVerified(user.emailVerified);
    return user.emailVerified;
  };

  const refreshRoles = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const [adminSnap, banSnap] = await Promise.allSettled([
      getDoc(doc(db, COL.admins, user.uid)),
      getDoc(doc(db, COL.bans, user.uid)),
    ]);
    setIsAdmin(adminSnap.status === 'fulfilled' && adminSnap.value.exists());
    if (banSnap.status === 'fulfilled' && banSnap.value.exists()) {
      setBan({ reason: (banSnap.value.data() as { reason?: string }).reason });
    } else {
      setBan(null);
    }
  };

  const logout = async () => {
    await signOut(auth);
    setUserProfile(null);
    setIsAdmin(false);
    setBan(null);
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
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      resetPassword,
      resendVerification,
      refreshVerification,
      refreshRoles,
      logout,
      isAuthModalOpen,
      authModalMode,
      authNotice,
      openAuthModal,
      closeAuthModal,
      requireMember,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUser, userProfile, loading, isAdmin, ban, emailVerified, canPost, isAuthModalOpen, authModalMode, authNotice, openAuthModal, closeAuthModal, requireMember],
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
