/**
 * Evidence-based authenticity scoring, verification tier classification,
 * and controlled publishing workflow for NaijaPages discovered businesses.
 *
 * Core trust principles:
 * - Existence in an external source != Owner Verified.
 * - Never auto-awards an "Owner Verified" badge merely because the bot found a listing.
 * - Contradictory evidence reduces confidence and blocks automatic publication.
 * - Single-source or lower-confidence candidates stay in `pending_admin_review`.
 */

export type VerificationTier =
  | 'discovered'
  | 'evidence_checked'
  | 'listing_verified'
  | 'owner_verified'
  | 'registry_corroborated';

export type LifecycleStatus =
  | 'discovered'
  | 'pending_verification'
  | 'pending_admin_review'
  | 'approved'
  | 'published'
  | 'unverified'
  | 'rejected'
  | 'duplicate'
  | 'potentially_outdated'
  | 'under_investigation'
  | 'confirmed_closed'
  | 'archived';

export interface VerificationEvidenceSignal {
  sourceId: string;
  sourceType: string;
  sourceReliability?: number; // 0..1
  evidenceType: string;
  fieldName: string;
  isContradictory?: boolean;
  isClosureSignal?: boolean;
  isRecentActivity?: boolean;
  isOfficialWebsiteConfirmed?: boolean;
  isPhoneConsistent?: boolean;
  isAddressCorroborated?: boolean;
  isRegistryCorroborated?: boolean;
  isOwnerVerified?: boolean;
}

export interface ConfidencePolicyConfig {
  autoPublishMinConfidence: number;
  autoPublishMinSources: number;
  reviewMinConfidence: number;
}

export const DEFAULT_CONFIDENCE_POLICY: ConfidencePolicyConfig = {
  autoPublishMinConfidence: 0.85,
  autoPublishMinSources: 2,
  reviewMinConfidence: 0.35,
};

export interface AuthenticityEvaluation {
  confidenceScore: number;
  corroboratingSourceCount: number;
  averageSourceReliability: number;
  verificationTier: VerificationTier;
  /** Strictly false unless an actual business owner verified ownership. */
  isOwnerVerifiedBadgeEligible: boolean;
  contradictionCount: number;
  closureSignalCount: number;
  reasons: string[];
}

const DEFAULT_SOURCE_RELIABILITY: Record<string, number> = {
  public_registry: 0.9,
  government_portal: 0.9,
  partner_api: 0.82,
  open_data: 0.65,
  map_directory: 0.65,
  web_directory: 0.6,
  other: 0.5,
};

export function getSourceReliabilityWeight(sourceType: string, override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0 && override <= 1) {
    return override;
  }
  return DEFAULT_SOURCE_RELIABILITY[sourceType] ?? 0.55;
}

/**
 * Evaluates a candidate business's accumulated evidence into a transparent confidence score,
 * verification tier, and explainable list of reasons.
 */
export function evaluateCandidateAuthenticity(
  signals: VerificationEvidenceSignal[],
): AuthenticityEvaluation {
  if (signals.length === 0) {
    return {
      confidenceScore: 0,
      corroboratingSourceCount: 0,
      averageSourceReliability: 0,
      verificationTier: 'discovered',
      isOwnerVerifiedBadgeEligible: false,
      contradictionCount: 0,
      closureSignalCount: 0,
      reasons: ['No traceable evidence records attached yet.'],
    };
  }

  const distinctSources = new Map<string, number>();
  let officialWebsiteConfirmed = false;
  let phoneConsistent = false;
  let addressCorroborated = false;
  let recentActivity = false;
  let registryCorroborated = false;
  let ownerVerified = false;
  let contradictionCount = 0;
  let closureSignalCount = 0;

  for (const sig of signals) {
    const rel = getSourceReliabilityWeight(sig.sourceType, sig.sourceReliability);
    if (!distinctSources.has(sig.sourceId) || (distinctSources.get(sig.sourceId) ?? 0) < rel) {
      distinctSources.set(sig.sourceId, rel);
    }
    if (sig.isOfficialWebsiteConfirmed || sig.evidenceType === 'website_check') {
      if (!sig.isContradictory && !sig.isClosureSignal) officialWebsiteConfirmed = true;
    }
    if (sig.isPhoneConsistent) phoneConsistent = true;
    if (sig.isAddressCorroborated) addressCorroborated = true;
    if (sig.isRecentActivity) recentActivity = true;
    if (sig.isRegistryCorroborated || sig.evidenceType === 'registry_match') {
      if (!sig.isContradictory) registryCorroborated = true;
    }
    if (sig.isOwnerVerified) ownerVerified = true;
    if (sig.isContradictory) contradictionCount += 1;
    if (sig.isClosureSignal) closureSignalCount += 1;
  }

  const sourceCount = distinctSources.size;
  const reliabilities = Array.from(distinctSources.values());
  const avgReliability =
    reliabilities.reduce((sum, r) => sum + r, 0) / Math.max(1, reliabilities.length);

  const reasons: string[] = [];
  let score = 0.25 + avgReliability * 0.25;
  reasons.push(`Base reliability from ${sourceCount} distinct source(s) (avg ${avgReliability.toFixed(2)}).`);

  if (sourceCount >= 2) {
    const multiSourceBonus = Math.min(0.24, (sourceCount - 1) * 0.14);
    score += multiSourceBonus;
    reasons.push(`Independent multi-source corroboration (+${multiSourceBonus.toFixed(2)}).`);
  }
  if (officialWebsiteConfirmed) {
    score += 0.1;
    reasons.push('Official website identity confirmed (+0.10).');
  }
  if (phoneConsistent) {
    score += 0.08;
    reasons.push('Public telephone number consistent across records (+0.08).');
  }
  if (addressCorroborated) {
    score += 0.08;
    reasons.push('Physical address/coordinates corroborated (+0.08).');
  }
  if (recentActivity) {
    score += 0.05;
    reasons.push('Recent public operational activity observed (+0.05).');
  }
  if (registryCorroborated) {
    score += 0.14;
    reasons.push('Authorised official registration data corroborated (+0.14).');
  }
  if (ownerVerified) {
    score += 0.12;
    reasons.push('Business owner claim verified (+0.12).');
  }

  // Contradictory evidence & closure signals strictly reduce confidence
  if (contradictionCount > 0) {
    const penalty = Math.min(0.45, contradictionCount * 0.18);
    score -= penalty;
    reasons.push(`Contradictory evidence penalty (${contradictionCount} conflict(s), -${penalty.toFixed(2)}).`);
  }
  if (closureSignalCount > 0) {
    const closurePenalty = Math.min(0.6, closureSignalCount * 0.22);
    score -= closurePenalty;
    reasons.push(`Closure warning signals detected (${closureSignalCount}, -${closurePenalty.toFixed(2)}).`);
  }

  // Single uncorroborated non-registry source cannot exceed 0.65
  if (sourceCount === 1 && !registryCorroborated && !ownerVerified) {
    score = Math.min(score, 0.65);
  }

  const confidenceScore = Number(Math.max(0, Math.min(0.99, score)).toFixed(3));

  // Determine honest verification tier (never conflating existence with ownership!)
  let verificationTier: VerificationTier = 'discovered';
  if (ownerVerified) {
    verificationTier = 'owner_verified';
  } else if (registryCorroborated) {
    verificationTier = 'registry_corroborated';
  } else if (sourceCount >= 2 && confidenceScore >= 0.85 && contradictionCount === 0 && closureSignalCount === 0) {
    verificationTier = 'listing_verified';
  } else if (officialWebsiteConfirmed || phoneConsistent || addressCorroborated || sourceCount >= 2) {
    verificationTier = 'evidence_checked';
  }

  return {
    confidenceScore,
    corroboratingSourceCount: sourceCount,
    averageSourceReliability: Number(avgReliability.toFixed(3)),
    verificationTier,
    isOwnerVerifiedBadgeEligible: ownerVerified,
    contradictionCount,
    closureSignalCount,
    reasons,
  };
}

export interface PublishingDecision {
  allowAutoPublish: boolean;
  lifecycleStatus: LifecycleStatus;
  reviewStatus: 'discovered' | 'needs_review' | 'approved' | 'rejected';
  requiresHumanReview: boolean;
  reviewReason:
    | 'low_confidence'
    | 'conflicting_data'
    | 'suspected_closure'
    | 'first_publication'
    | null;
  suggestedAction: 'approve_publish' | 'request_verification' | 'reject' | 'archive_closed';
  explanation: string;
}

/**
 * Controlled publishing gate enforcing strict minimum evidence before a bot-discovered
 * candidate can become publicly visible in the directory.
 */
export function evaluatePublishingDecision(
  evalResult: AuthenticityEvaluation,
  candidateFields: {
    hasName: boolean;
    hasState: boolean;
    hasCategory: boolean;
    hasLocationOrContact: boolean;
  },
  policy: ConfidencePolicyConfig = DEFAULT_CONFIDENCE_POLICY,
): PublishingDecision {
  if (!candidateFields.hasName || !candidateFields.hasCategory || !candidateFields.hasState) {
    return {
      allowAutoPublish: false,
      lifecycleStatus: 'pending_verification',
      reviewStatus: 'needs_review',
      requiresHumanReview: true,
      reviewReason: 'low_confidence',
      suggestedAction: 'request_verification',
      explanation: 'Missing required name, category, or Nigerian state; cannot auto-publish.',
    };
  }

  if (evalResult.closureSignalCount > 0) {
    return {
      allowAutoPublish: false,
      lifecycleStatus: 'under_investigation',
      reviewStatus: 'needs_review',
      requiresHumanReview: true,
      reviewReason: 'suspected_closure',
      suggestedAction: 'archive_closed',
      explanation: 'Closure signals present; blocked from publication until investigated.',
    };
  }

  if (evalResult.contradictionCount > 0) {
    return {
      allowAutoPublish: false,
      lifecycleStatus: 'pending_admin_review',
      reviewStatus: 'needs_review',
      requiresHumanReview: true,
      reviewReason: 'conflicting_data',
      suggestedAction: 'request_verification',
      explanation: 'Conflicting evidence across sources requires administrator review.',
    };
  }

  if (
    candidateFields.hasLocationOrContact &&
    evalResult.confidenceScore >= policy.autoPublishMinConfidence &&
    evalResult.corroboratingSourceCount >= policy.autoPublishMinSources
  ) {
    return {
      allowAutoPublish: true,
      lifecycleStatus: 'published',
      reviewStatus: 'approved',
      requiresHumanReview: false,
      reviewReason: null,
      suggestedAction: 'approve_publish',
      explanation: `Meets automated publication policy (confidence ${evalResult.confidenceScore} >= ${policy.autoPublishMinConfidence}, sources ${evalResult.corroboratingSourceCount} >= ${policy.autoPublishMinSources}).`,
    };
  }

  if (evalResult.confidenceScore < policy.reviewMinConfidence) {
    return {
      allowAutoPublish: false,
      lifecycleStatus: 'pending_verification',
      reviewStatus: 'needs_review',
      requiresHumanReview: true,
      reviewReason: 'low_confidence',
      suggestedAction: 'request_verification',
      explanation: `Confidence ${evalResult.confidenceScore} is below review threshold (${policy.reviewMinConfidence}); additional corroboration required.`,
    };
  }

  return {
    allowAutoPublish: false,
    lifecycleStatus: 'pending_admin_review',
    reviewStatus: 'needs_review',
    requiresHumanReview: true,
    reviewReason: 'first_publication',
    suggestedAction: 'approve_publish',
    explanation: `Single-source or moderate confidence (${evalResult.confidenceScore}); queued for administrator review before publication.`,
  };
}
