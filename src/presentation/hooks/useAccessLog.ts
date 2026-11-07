import { useCallback, useEffect, useState } from 'react';
import type { AccessView } from '../../domain/entities/AccessView';
import type { IAccessLogService } from '../../domain/services/IAccessLogService';
import { describeAccessLogError } from '../../application/accessLog';

export type AccessLogStatus = 'loading' | 'ready' | 'error';

/** Loads who has viewed the patient's records. */
export function useAccessLog(service: IAccessLogService, userId: string, enabled = true) {
  const [status, setStatus] = useState<AccessLogStatus>('loading');
  const [views, setViews] = useState<readonly AccessView[]>([]);
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setStatus('loading');
    service
      .list(userId)
      .then((loaded) => {
        if (!active) return;
        setViews(loaded);
        setStatus('ready');
      })
      .catch((error) => {
        if (!active) return;
        setViews([]);
        setMessage(describeAccessLogError(error));
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [service, userId, enabled, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { status, views, message, retry };
}
