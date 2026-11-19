import type { Bindings } from '../types';

export type EmailKind = 'verification' | 'password-reset';

export interface OutboundEmail {
  kind: EmailKind;
  to: string;
  subject: string;
  url: string;
  token: string;
  html: string;
  text: string;
}

export type EmailHook = (email: OutboundEmail) => Promise<void> | void;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildVerificationEmail(params: {
  appName: string;
  to: string;
  name?: string | null;
  url: string;
  token: string;
}): OutboundEmail {
  const greeting = params.name ? `Hi ${escapeHtml(params.name)},` : 'Hello,';
  const safeUrl = escapeHtml(params.url);
  const subject = `Verify your ${params.appName} email address`;
  const text = [
    params.name ? `Hi ${params.name},` : 'Hello,',
    '',
    `Confirm your email address to activate posting, reviews, and marketplace listings on ${params.appName}:`,
    params.url,
    '',
    'This link expires in 1 hour. If you did not create an account, you can ignore this email.',
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0f172a;">
      <div style="background: #059669; color: #ffffff; padding: 16px 20px; border-radius: 12px 12px 0 0; font-weight: 700; font-size: 18px;">
        ${escapeHtml(params.appName)}
      </div>
      <div style="border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; padding: 24px; background: #ffffff;">
        <p style="margin: 0 0 12px; font-size: 15px;">${greeting}</p>
        <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #334155;">
          Verify your email address to finish setting up your ${escapeHtml(params.appName)} account so you can list businesses, post marketplace ads, and publish reviews.
        </p>
        <p style="margin: 0 0 20px;">
          <a href="${safeUrl}" style="display: inline-block; background: #059669; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 20px; border-radius: 10px;">
            Verify Email Address
          </a>
        </p>
        <p style="margin: 0 0 8px; font-size: 12px; color: #64748b;">Or copy and paste this link into your browser:</p>
        <p style="margin: 0 0 16px; font-size: 12px; color: #0f172a; word-break: break-all;">${safeUrl}</p>
        <p style="margin: 0; font-size: 12px; color: #94a3b8;">This link expires in 1 hour. If you didn’t sign up, you can safely ignore this message.</p>
      </div>
    </div>
  `.trim();

  return {
    kind: 'verification',
    to: params.to,
    subject,
    url: params.url,
    token: params.token,
    html,
    text,
  };
}

export function buildPasswordResetEmail(params: {
  appName: string;
  to: string;
  name?: string | null;
  url: string;
  token: string;
}): OutboundEmail {
  const greeting = params.name ? `Hi ${escapeHtml(params.name)},` : 'Hello,';
  const safeUrl = escapeHtml(params.url);
  const subject = `Reset your ${params.appName} password`;
  const text = [
    params.name ? `Hi ${params.name},` : 'Hello,',
    '',
    `We received a request to reset your ${params.appName} password. Use the link below to choose a new password:`,
    params.url,
    '',
    'This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.',
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0f172a;">
      <div style="background: #059669; color: #ffffff; padding: 16px 20px; border-radius: 12px 12px 0 0; font-weight: 700; font-size: 18px;">
        ${escapeHtml(params.appName)}
      </div>
      <div style="border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; padding: 24px; background: #ffffff;">
        <p style="margin: 0 0 12px; font-size: 15px;">${greeting}</p>
        <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #334155;">
          Use the button below to choose a new password for your ${escapeHtml(params.appName)} account.
        </p>
        <p style="margin: 0 0 20px;">
          <a href="${safeUrl}" style="display: inline-block; background: #059669; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 20px; border-radius: 10px;">
            Reset Password
          </a>
        </p>
        <p style="margin: 0 0 8px; font-size: 12px; color: #64748b;">Or copy and paste this link into your browser:</p>
        <p style="margin: 0 0 16px; font-size: 12px; color: #0f172a; word-break: break-all;">${safeUrl}</p>
        <p style="margin: 0; font-size: 12px; color: #94a3b8;">This link expires in 1 hour. If you didn’t request this change, no action is required.</p>
      </div>
    </div>
  `.trim();

  return {
    kind: 'password-reset',
    to: params.to,
    subject,
    url: params.url,
    token: params.token,
    html,
    text,
  };
}

/**
 * Sends transactional email via Resend HTTP API (Workers-compatible).
 * In non-production when RESEND_API_KEY is unset, logs a dev console preview
 * instead of failing so local registration and reset flows remain testable.
 */
export async function sendTransactionalEmail(
  env: Bindings,
  email: OutboundEmail,
  hook?: EmailHook,
): Promise<void> {
  if (hook) {
    await hook(email);
  }

  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim() || 'NaijaPages <noreply@naijapages.ng>';

  if (!apiKey) {
    if (env.APP_ENV === 'production') {
      throw new Error('RESEND_API_KEY is required in production to send transactional emails.');
    }
    console.info(`[mail:dev] ${email.kind} to=${email.to} url=${email.url}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[mail:resend] status=${res.status} body=${body.slice(0, 300)}`);
    throw new Error(`Failed to send ${email.kind} email via Resend (${res.status}).`);
  }
}
