import React from 'react';
import { AlertTriangle, Ban } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { REQUIRE_VERIFIED_EMAIL } from '../lib/config';

/** Slim notice under the header: unverified email, or suspended account. Renders nothing for everyone else. */
export const AccountBanner: React.FC = () => {
  const { currentUser, ban, emailVerified, openAuthModal } = useAuth();
  if (!currentUser) return null;

  if (ban) {
    return (
      <div role="alert" className="bg-rose-600 text-white text-xs px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 font-semibold"><Ban size={14} /> Your account is suspended. You can browse, but you can’t post, review or report.</span>
        <button type="button" onClick={() => openAuthModal('banned')} className="underline underline-offset-2 font-bold">Details</button>
      </div>
    );
  }

  if (REQUIRE_VERIFIED_EMAIL && !emailVerified) {
    return (
      <div role="status" className="bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 border-b border-amber-200 dark:border-amber-900 text-xs px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} /> Verify your email address to list businesses, post ads and write reviews.</span>
        <button type="button" onClick={() => openAuthModal('verify')} className="underline underline-offset-2 font-bold">Verify now</button>
      </div>
    );
  }

  return null;
};
