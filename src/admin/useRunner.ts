import { useCallback, useState } from 'react';
import { ApiClientError } from '../lib/apiClient';
import { friendlyError, logError } from '../lib/errors';
import { useToast } from './ui';

/**
 * Runs an admin action with a busy flag and consistent success / error toasts.
 * Plain `Error`s and server validation errors are shown as-is; transport/auth codes are translated.
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
        if (err instanceof ApiClientError && (err.code === 'VALIDATION_ERROR' || err.code === 'BAD_REQUEST' || err.code === 'NOT_FOUND')) {
          toast.error(err.message);
        } else {
          const hasCode = typeof (err as { code?: unknown })?.code === 'string';
          toast.error(!hasCode && err instanceof Error ? err.message : friendlyError(err, 'That didn’t work. Please try again.'));
        }
        return false;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  return { busy, run };
}
