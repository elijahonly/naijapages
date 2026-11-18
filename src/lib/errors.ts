/** Turns Firebase errors into messages a visitor can act on (never leaks raw error text or PII). */
export function friendlyError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const code = (err as { code?: string } | null)?.code ?? '';
  switch (code) {
    case 'permission-denied':
      return "That action isn't allowed for your account right now. Make sure you're signed in with a verified email. If your account was suspended, contact us.";
    case 'unauthenticated':
      return 'Please sign in and try again.';
    case 'unavailable':
    case 'auth/network-request-failed':
    case 'deadline-exceeded':
      return 'Network problem. Check your connection and try again.';
    case 'resource-exhausted':
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'already-exists':
      return 'That has already been submitted.';
    default:
      return fallback;
  }
}

/** Log without personal data: just the error code and where it happened. */
export function logError(where: string, err: unknown): void {
  const code = (err as { code?: string } | null)?.code;
  console.error(`[naijapages] ${where}${code ? ` (${code})` : ''}`);
}

/** Sign-in / sign-up error text for Firebase Auth error codes. */
export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code || '';
  switch (code) {
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password. Please check and try again.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.';
    case 'auth/weak-password':
      return 'That password is too weak. Use at least 8 characters with letters and numbers.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is switched off. In the Firebase console, enable it under Authentication → Sign-in method.';
    case 'auth/unauthorized-domain':
      return 'This website address is not authorised for sign-in yet. Add it under Firebase console → Authentication → Settings → Authorized domains.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was cancelled.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in pop-up. Please allow pop-ups for this site and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact us if you think this is a mistake.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'Network problem. Check your connection and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
