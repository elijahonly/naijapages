export class AuthServiceError extends Error {
  code: string;
  status?: number;

  constructor(code: string, message?: string, status?: number) {
    super(message || code);
    this.name = 'AuthServiceError';
    this.code = code;
    this.status = status;
  }
}

/** Turns auth and data errors into messages a visitor can act on (never leaks raw error text or PII). */
export function friendlyError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const code = (err as { code?: string } | null)?.code ?? '';
  switch (code) {
    case 'permission-denied':
    case 'FORBIDDEN':
      return "That action isn't allowed for your account right now. Make sure you're signed in with a verified email. If your account was suspended, contact us.";
    case 'EMAIL_NOT_VERIFIED':
      return 'Please verify your email address before continuing.';
    case 'ACCOUNT_BANNED':
      return 'This account has been suspended. Please contact support if you think this is a mistake.';
    case 'unauthenticated':
    case 'UNAUTHORIZED':
      return 'Please sign in and try again.';
    case 'unavailable':
    case 'auth/network-request-failed':
    case 'AUTH_BACKEND_UNAVAILABLE':
    case 'deadline-exceeded':
      return 'Network or server unavailable. Check your connection and try again.';
    case 'resource-exhausted':
    case 'auth/too-many-requests':
    case 'TOO_MANY_REQUESTS':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'already-exists':
    case 'ALREADY_EXISTS':
    case 'CONFLICT':
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

/** Sign-in / sign-up error text for Better Auth & Worker API error codes. */
export function authErrorMessage(err: unknown): string {
  const code = ((err as { code?: string } | null)?.code || '').toUpperCase();

  switch (code) {
    case 'INVALID_EMAIL':
      return 'Please enter a valid email address.';
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_CREDENTIALS':
    case 'INVALID_PASSWORD':
    case 'USER_NOT_FOUND':
      return 'Incorrect email or password. Please check and try again.';
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'An account with this email already exists. Try signing in instead, or use "Forgot password?" to set a password.';
    case 'EMAIL_NOT_VERIFIED':
      return 'Please verify your email address before signing in. Check your inbox or request a new verification link.';
    case 'PASSWORD_TOO_SHORT':
    case 'WEAK_PASSWORD':
      return 'That password is too weak. Use at least 8 characters with letters and numbers.';
    case 'PASSWORD_TOO_LONG':
      return 'That password is too long. Please use 128 characters or fewer.';
    case 'INVALID_TOKEN':
    case 'TOKEN_EXPIRED':
      return 'That verification or password reset link is invalid or has expired. Request a fresh link and try again.';
    case 'ACCOUNT_BANNED':
      return 'This account has been suspended. Please contact support if you think this is a mistake.';
    case 'GOOGLE_OAUTH_NOT_CONFIGURED':
      return 'Google sign-in is not configured on this server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to Worker secrets, or sign in with email and password.';
    case 'ACCOUNT_NOT_LINKED':
      return 'Could not automatically link this Google account. Sign in with your verified email first or contact support.';
    case 'TOO_MANY_REQUESTS':
    case 'RATE_LIMIT_EXCEEDED':
      return 'Too many attempts. Please wait a minute and try again.';
    case 'AUTH_BACKEND_UNAVAILABLE':
      return 'Authentication service is temporarily unavailable. Please try again in a moment.';
    default:
      if (err instanceof AuthServiceError && err.message && err.message !== err.code) {
        return err.message;
      }
      return 'Something went wrong. Please try again.';
  }
}
