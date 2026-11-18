/**
 * Single source of truth for the site's browser-side security policy.
 *
 * Used by vite.config.ts at build time to:
 *   1. inject a Content-Security-Policy <meta> tag into dist/index.html, and
 *   2. emit dist/_headers (understood by Netlify and Cloudflare Pages).
 * firebase.json carries the same values for Firebase Hosting.
 *
 * If something stops loading after you deploy, open the browser console and look for
 * "Refused to load … because it violates the following Content Security Policy".
 * Add the blocked host to the matching directive below (or build with VITE_DISABLE_CSP=true
 * to switch the CSP off while you investigate).
 */

export function buildCsp(authDomain: string, opts: { frameAncestors?: boolean } = {}): string {
  const auth = authDomain ? ` https://${authDomain}` : '';
  const directives = [
    "default-src 'self'",
    // Firebase Auth's pop-up flow loads Google's gapi script; reCAPTCHA is only used if App Check is switched on.
    "script-src 'self' https://apis.google.com https://www.gstatic.com https://www.google.com https://www.recaptcha.net",
    // Inline styles are needed by React's style props and Tailwind-generated rules.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // Members paste image links from anywhere, so images may come from any https host.
    "img-src 'self' data: blob: https:",
    `connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebaseapp.com${auth} https://www.google.com https://www.recaptcha.net`,
    `frame-src 'self' https://*.firebaseapp.com${auth} https://accounts.google.com https://apis.google.com https://maps.google.com https://www.google.com https://www.recaptcha.net`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  // frame-ancestors only works as an HTTP header (browsers ignore it inside <meta>).
  if (opts.frameAncestors) directives.push("frame-ancestors 'self'");
  return directives.join('; ');
}

/** Headers to send with every response. */
export function securityHeaders(authDomain: string): Record<string, string> {
  return {
    'Content-Security-Policy': buildCsp(authDomain, { frameAncestors: true }),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    // "allow-popups" keeps Google sign-in (a pop-up window) working; "same-origin" would break it.
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Strict-Transport-Security': 'max-age=31536000',
  };
}
