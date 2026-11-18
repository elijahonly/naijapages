import { useCallback, useState } from 'react';
import { friendlyError, logError } from '../lib/errors';
import { useToast } from './ui';

/**
 * Runs an admin action with a busy flag and consistent success / error toasts.
 * Plain `Error`s (validation messages written by us) are shown as-is; Firebase errors are translated.
 */
export function useRunner() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>, success?: string): Promise<boolean> => {
      setBusy(key);
      try {
        await fn();
        if (success) toast.success(success);
        return true;
      } catch (err) {
        logError(`admin action ${key.split(':')[0]}`, err);
        const isFirebase = typeof (err as { code?: unknown })?.code === 'string';
        toast.error(!isFirebase && err instanceof Error ? err.message : friendlyError(err, 'That didn’t work. Please try again.'));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  return { busy, run };
}
