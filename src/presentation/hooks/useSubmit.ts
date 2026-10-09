import { useCallback, useState } from 'react';
import { describeAuthError } from '../../application/describeAuthError';

/**
 * Runs an async action and tracks whether it is running and what went wrong,
 * so each screen does not repeat the same loading and error state.
 */
export function useSubmit() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(describeAuthError(caught));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { loading, error, run, clearError };
}
