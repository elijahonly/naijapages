import { DISCOVERY_LIMITS } from '../../lib/discoveryValidation';
import { cleanText, ValidationError } from '../../lib/validation';

export type DiscoveryErrorKind = 'transient' | 'rate_limited' | 'permanent' | 'invalid_message';

export class DiscoveryJobError extends Error {
  readonly kind: DiscoveryErrorKind;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    opts: {
      kind: DiscoveryErrorKind;
      code: string;
      retryAfterSeconds?: number;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'DiscoveryJobError';
    this.kind = opts.kind;
    this.code = opts.code;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    if (opts.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}

export interface ClassifiedDiscoveryError {
  kind: DiscoveryErrorKind;
  code: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  safeMessage: string;
}

const SECRET_REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [/cfat_[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]'],
  [/\b(?:api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;]+/gi, '[REDACTED_CREDENTIAL]'],
];

/**
 * Produces a bounded, secret-redacted error message safe for D1 storage and structured logs.
 */
export function sanitizeDiscoveryErrorMessage(
  err: unknown,
  maxLength: number = DISCOVERY_LIMITS.errorMessage,
): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Unexpected discovery processing error.';
  let redacted = raw;
  for (const [pattern, replacement] of SECRET_REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return cleanText(redacted, maxLength) || 'Unexpected discovery processing error.';
}

/**
 * Classifies an error into retryable (`transient`, `rate_limited`) vs non-retryable
 * (`permanent`, `invalid_message`) categories so permanent errors never loop forever.
 */
export function classifyDiscoveryError(err: unknown): ClassifiedDiscoveryError {
  const safeMessage = sanitizeDiscoveryErrorMessage(err);

  if (err instanceof DiscoveryJobError) {
    return {
      kind: err.kind,
      code: err.code,
      retryable: err.kind === 'transient' || err.kind === 'rate_limited',
      retryAfterSeconds: err.retryAfterSeconds,
      safeMessage,
    };
  }

  if (err instanceof ValidationError) {
    return {
      kind: 'permanent',
      code: err.code || 'VALIDATION_ERROR',
      retryable: false,
      safeMessage,
    };
  }

  if (err instanceof SyntaxError || err instanceof TypeError || err instanceof RangeError) {
    return {
      kind: 'permanent',
      code: err.name.toUpperCase(),
      retryable: false,
      safeMessage,
    };
  }

  const lower = safeMessage.toLowerCase();
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      kind: 'rate_limited',
      code: 'RATE_LIMITED',
      retryable: true,
      retryAfterSeconds: 120,
      safeMessage,
    };
  }

  if (
    lower.includes('constraint failed') ||
    lower.includes('unapproved source') ||
    lower.includes('not found') ||
    lower.includes('forbidden') ||
    lower.includes('unauthorized')
  ) {
    return {
      kind: 'permanent',
      code: 'PERMANENT_FAILURE',
      retryable: false,
      safeMessage,
    };
  }

  return {
    kind: 'transient',
    code: 'TRANSIENT_ERROR',
    retryable: true,
    safeMessage,
  };
}

/**
 * Computes controlled exponential backoff delay in seconds for Cloudflare Queue retries.
 * Supports optional bounded jitter (`jitterRatio` in [0, 0.5]) to prevent synchronized retry storms.
 */
export function computeRetryDelaySeconds(
  attempt: number,
  opts: {
    baseSeconds?: number;
    maxSeconds?: number;
    retryAfterSeconds?: number;
    jitterRatio?: number;
    randomFn?: () => number;
  } = {},
): number {
  const base = Math.max(5, Math.trunc(opts.baseSeconds ?? 30));
  const max = Math.max(base, Math.trunc(opts.maxSeconds ?? 600));
  const safeAttempt = Math.max(1, Math.trunc(attempt));
  let delay = Math.min(max, base * 2 ** (safeAttempt - 1));
  if (typeof opts.retryAfterSeconds === 'number' && Number.isFinite(opts.retryAfterSeconds)) {
    delay = Math.min(max, Math.max(delay, Math.trunc(opts.retryAfterSeconds)));
  }

  const jitterRatio =
    typeof opts.jitterRatio === 'number' && Number.isFinite(opts.jitterRatio)
      ? Math.min(0.5, Math.max(0, opts.jitterRatio))
      : 0;
  if (jitterRatio > 0) {
    const rand = (opts.randomFn ?? Math.random)();
    const spread = delay * jitterRatio;
    const jittered = Math.round(delay + (rand * 2 - 1) * spread);
    return Math.min(max, Math.max(base, jittered));
  }

  return delay;
}
