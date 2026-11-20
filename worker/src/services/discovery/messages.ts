import {
  DISCOVERY_JOB_TYPES,
  DISCOVERY_LIMITS,
  validateEpochTimestamp,
  validateRequiredIdentifier,
  type DiscoveryJobType,
} from '../../lib/discoveryValidation';
import {
  DISCOVERY_QUEUE_MESSAGE_SCHEMA_VERSION,
  type DiscoveryQueueMessage,
} from '../../types';
import { DiscoveryJobError } from './errors';

const MAX_QUEUE_MESSAGE_BYTES = 2048;

export function buildDiscoveryQueueMessage(params: {
  jobId: string;
  jobType: DiscoveryJobType;
  enqueuedAt?: number;
  correlationId?: string;
}): DiscoveryQueueMessage {
  const msg: DiscoveryQueueMessage = {
    schemaVersion: DISCOVERY_QUEUE_MESSAGE_SCHEMA_VERSION,
    jobId: validateRequiredIdentifier(params.jobId, 'jobId', DISCOVERY_LIMITS.id),
    jobType: params.jobType,
    enqueuedAt:
      validateEpochTimestamp(params.enqueuedAt ?? Date.now(), 'enqueuedAt', { required: true })!,
    correlationId: validateRequiredIdentifier(
      params.correlationId ?? crypto.randomUUID(),
      'correlationId',
      DISCOVERY_LIMITS.id,
    ),
  };
  return validateDiscoveryQueueMessage(msg);
}

/**
 * Strictly validates an incoming Cloudflare Queue message payload.
 * Rejects unsupported schema versions, missing job pointers, unknown job types,
 * and oversized payloads (queue messages must never carry business records).
 */
export function validateDiscoveryQueueMessage(raw: unknown): DiscoveryQueueMessage {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new DiscoveryJobError('Discovery queue message must be a JSON object.', {
      kind: 'invalid_message',
      code: 'INVALID_MESSAGE_BODY',
    });
  }

  let serializedBytes = 0;
  try {
    serializedBytes = JSON.stringify(raw).length;
  } catch {
    throw new DiscoveryJobError('Discovery queue message is not serializable.', {
      kind: 'invalid_message',
      code: 'INVALID_MESSAGE_BODY',
    });
  }

  if (serializedBytes > MAX_QUEUE_MESSAGE_BYTES) {
    throw new DiscoveryJobError(
      `Discovery queue message exceeds maximum size of ${MAX_QUEUE_MESSAGE_BYTES} bytes.`,
      {
        kind: 'invalid_message',
        code: 'MESSAGE_TOO_LARGE',
      },
    );
  }

  const record = raw as Record<string, unknown>;

  if (record.schemaVersion !== DISCOVERY_QUEUE_MESSAGE_SCHEMA_VERSION) {
    throw new DiscoveryJobError(
      `Unsupported discovery queue message schemaVersion: ${String(record.schemaVersion)}.`,
      {
        kind: 'invalid_message',
        code: 'UNSUPPORTED_SCHEMA_VERSION',
      },
    );
  }

  if (typeof record.jobType !== 'string' || !(DISCOVERY_JOB_TYPES as readonly string[]).includes(record.jobType)) {
    throw new DiscoveryJobError(`Unsupported discovery jobType: "${String(record.jobType)}".`, {
      kind: 'invalid_message',
      code: 'INVALID_JOB_TYPE',
    });
  }

  let jobId: string;
  let enqueuedAt: number;
  let correlationId: string;
  try {
    jobId = validateRequiredIdentifier(record.jobId, 'jobId', DISCOVERY_LIMITS.id);
    enqueuedAt = validateEpochTimestamp(record.enqueuedAt, 'enqueuedAt', { required: true })!;
    correlationId = validateRequiredIdentifier(
      record.correlationId,
      'correlationId',
      DISCOVERY_LIMITS.id,
    );
  } catch (err) {
    throw new DiscoveryJobError(
      err instanceof Error ? err.message : 'Invalid discovery queue message fields.',
      {
        kind: 'invalid_message',
        code: 'INVALID_MESSAGE_FIELDS',
        cause: err,
      },
    );
  }

  return {
    schemaVersion: DISCOVERY_QUEUE_MESSAGE_SCHEMA_VERSION,
    jobId,
    jobType: record.jobType as DiscoveryJobType,
    enqueuedAt,
    correlationId,
  };
}
