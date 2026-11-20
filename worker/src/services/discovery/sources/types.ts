import type { BusinessEvidenceType } from '../../../lib/discoveryValidation';
import type { Bindings } from '../../../types';
import type { ClassifiedDiscoveryError } from '../errors';

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface DiscoveryQueryRequest {
  country: string;
  state?: string | null;
  lga?: string | null;
  category?: string | null;
  bbox: BoundingBox;
  maxResults: number;
  endpointUrl?: string | null;
}

export interface SourceAttribution {
  sourceId: string;
  sourceName: string;
  sourceType:
    | 'open_data'
    | 'public_registry'
    | 'map_directory'
    | 'government_portal'
    | 'partner_api'
    | 'web_directory'
    | 'other';
  licenceName: string;
  licenceUrl: string;
  attributionText: string;
  permittedUsage: string;
}

export interface CandidateEvidenceInput {
  evidenceType: BusinessEvidenceType;
  fieldName: string;
  evidenceValue: string | null;
  sourceUrl: string | null;
  sourceRecordId: string;
  sourceTimestamp: number | null;
  confidence: number;
  notes?: string | null;
}

export interface NormalizedDiscoveredCandidate {
  sourceRecordId: string;
  sourceRecordType: string;
  sourceUrl: string | null;
  name: string;
  normalizedName: string;
  category: string | null;
  subcategory: string | null;
  country: string;
  state: string | null;
  lga: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  email: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  openingHours: string | null;
  description: string | null;
  brand: string | null;
  operator: string | null;
  rawSourceData: Record<string, unknown>;
  normalizedData: Record<string, unknown>;
  identityHash: string;
  confidenceScore: number;
  sourceTimestamp: number | null;
  evidence: CandidateEvidenceInput[];
}

export interface SourceHealthCheckResult {
  ok: boolean;
  sourceId: string;
  endpoint: string | null;
  statusCode?: number;
  latencyMs: number;
  message: string;
}

export interface SourceDiscoveryBatchResult {
  sourceId: string;
  endpoint: string;
  retrievedAt: number;
  sourceDataTimestamp: number | null;
  totalRawElements: number;
  candidates: NormalizedDiscoveredCandidate[];
  rejectedCount: number;
  rejectionReasons: Record<string, number>;
  truncated: boolean;
  cached: boolean;
}

export interface DiscoverySourceAdapterOptions {
  fetchImpl?: typeof fetch;
  now?: number;
  skipCache?: boolean;
}

/**
 * Common contract implemented by every external business discovery connector.
 * Keeps source-specific query syntax, response parsing, and error mapping isolated
 * from the generic discovery orchestration engine.
 */
export interface DiscoverySourceAdapter {
  readonly id: string;
  readonly attribution: SourceAttribution;
  validateQuery(raw: Partial<DiscoveryQueryRequest>): DiscoveryQueryRequest;
  healthCheck(
    env: Partial<Bindings>,
    opts?: DiscoverySourceAdapterOptions,
  ): Promise<SourceHealthCheckResult>;
  discover(
    request: Partial<DiscoveryQueryRequest>,
    env: Partial<Bindings>,
    opts?: DiscoverySourceAdapterOptions,
  ): Promise<SourceDiscoveryBatchResult>;
  classifyError(err: unknown): ClassifiedDiscoveryError;
}
