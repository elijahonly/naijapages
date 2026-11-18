import { Business, BusinessReview } from '../types';

export interface RatingSummary {
  /** "4.8", or "New" when nobody has rated the business yet. */
  label: string;
  /** Number of ratings the label is based on. */
  count: number;
  hasRating: boolean;
}

/**
 * Display rating for a business. Community listings start with no rating
 * (instead of the old hard-coded 5.0) and show "New" until real reviews arrive.
 * Live member reviews are blended into any rating the business already has.
 */
export function ratingSummary(business: Pick<Business, 'rating' | 'reviewsCount'>, live: BusinessReview[] = []): RatingSummary {
  const baseCount = business.reviewsCount || 0;
  const liveCount = live.length;
  const total = baseCount + liveCount;
  if (total === 0 || (baseCount === 0 && liveCount === 0)) return { label: 'New', count: 0, hasRating: false };

  const sum = (baseCount ? business.rating * baseCount : 0) + live.reduce((acc, r) => acc + r.rating, 0);
  return { label: (sum / total).toFixed(1), count: total, hasRating: true };
}
