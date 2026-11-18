import React, { useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { hashString } from '../lib/daily';

interface AnnouncementBarProps {
  enabled: boolean;
  text: string;
}

/** Site-wide notice edited by admins (Settings → Announcement). Dismissal is remembered per message for the session. */
export const AnnouncementBar: React.FC<AnnouncementBarProps> = ({ enabled, text }) => {
  const key = `np_ann_${hashString(text)}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });

  if (!enabled || !text || dismissed) return null;

  return (
    <div role="status" className="bg-amber-400 text-slate-950 text-xs font-semibold px-4 py-2 flex items-center justify-center gap-2 relative">
      <Megaphone size={14} className="shrink-0" />
      <span className="text-center leading-snug pr-6">{text}</span>
      <button
        type="button"
        aria-label="Dismiss announcement"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem(key, '1');
          } catch {
            /* ignore */
          }
        }}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-black/10"
      >
        <X size={14} />
      </button>
    </div>
  );
};
