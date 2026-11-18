import { createContext, useContext } from 'react';
import { Business, ClaimRecord, ListingOverride, MarketplaceItem, ReportRecord } from '../types';
import type { AdminCtx } from './api';

/** The signed-in admin plus live "needs attention" queues, shared by every admin page. */
export interface AdminContextValue {
  admin: AdminCtx;
  pendingBusinesses: Business[];
  pendingAds: MarketplaceItem[];
  openReports: ReportRecord[];
  pendingClaims: ClaimRecord[];
  newMessageCount: number;
  /** Admin moderation flags on the built-in (seed) listings. */
  overrides: ListingOverride[];
}

export const AdminContext = createContext<AdminContextValue | null>(null);

export const useAdmin = (): AdminContextValue => {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used inside the admin shell');
  return ctx;
};
