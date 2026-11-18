import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

/**
 * App Check (optional but recommended): proves requests come from your real
 * website, which blocks scripts/bots that call your Firebase project directly.
 * It switches on automatically once a reCAPTCHA v3 site key is provided via
 * VITE_RECAPTCHA_SITE_KEY (or `recaptchaSiteKey` in firebase-applet-config.json).
 * See docs/SECURITY.md.
 */
const appCheckKey =
  (import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined) || firebaseConfig.recaptchaSiteKey;

if (appCheckKey) {
  try {
    if (import.meta.env.DEV) {
      (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn('App Check could not start:', (err as { code?: string })?.code ?? 'unknown error');
  }
}

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
// Always show the account chooser so a shared device never silently reuses someone else's Google session.
googleProvider.setCustomParameters({ prompt: 'select_account' });
