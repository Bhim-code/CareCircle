import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { APPROVAL_CHECK_INTERVAL_MS, type ApprovalCheck } from '../../application/approval';

/**
 * Looks again whether a waiting account has been approved: when the app comes back to the
 * front, once a minute while the screen is open, and whenever the person taps "Check again".
 */
export function useApprovalWatch(check: () => Promise<ApprovalCheck>) {
  const [checking, setChecking] = useState(false);
  const [last, setLast] = useState<ApprovalCheck | null>(null);
  const checkRef = useRef(check);
  checkRef.current = check;
  const busy = useRef(false);
  const alive = useRef(true);

  const run = useCallback(async () => {
    if (busy.current) return; // one check at a time
    busy.current = true;
    setChecking(true);
    try {
      const result = await checkRef.current();
      if (alive.current) setLast(result);
    } finally {
      busy.current = false;
      if (alive.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => void run(), APPROVAL_CHECK_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void run();
    });
    return () => {
      alive.current = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [run]);

  return { checking, last, checkNow: run };
}
