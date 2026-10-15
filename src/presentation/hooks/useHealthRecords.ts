import { useCallback, useEffect, useState } from 'react';
import type { HealthRecord } from '../../domain/entities/HealthRecord';
import type { IHealthRecordService } from '../../domain/services/IHealthRecordService';

export type RecordsStatus = 'loading' | 'ready' | 'error';

/** Loads one person's health records, and lets the screen try again if loading fails. */
export function useHealthRecords(service: IHealthRecordService, userId: string) {
  const [status, setStatus] = useState<RecordsStatus>('loading');
  const [records, setRecords] = useState<readonly HealthRecord[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    service
      .list(userId)
      .then((loaded) => {
        if (!active) return;
        setRecords(loaded);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setRecords([]);
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [service, userId, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return { status, records, retry };
}
