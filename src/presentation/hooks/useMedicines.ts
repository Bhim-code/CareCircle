import { useCallback, useEffect, useState } from 'react';
import { describeServiceError } from '../../application/describeServiceError';
import type { Medicine, MedicineInput } from '../../domain/entities/Medicine';
import type { IMedicineService } from '../../domain/services/IMedicineService';

export type MedicinesStatus = 'loading' | 'ready' | 'error';

/** Either it worked, or a sentence the screen can show about why it did not. */
export type SaveResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** Loads one person's medicines. Lets the screens try again, add a medicine and stop one. */
export function useMedicines(service: IMedicineService, userId: string, enabled = true) {
  const [status, setStatus] = useState<MedicinesStatus>('loading');
  const [medicines, setMedicines] = useState<readonly Medicine[]>([]);
  const [attempt, setAttempt] = useState(0);
  // Goes up each time a medicine is added or stopped, so today's doses and the alarms can reload.
  const [changeCount, setChangeCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setStatus('loading');
    service
      .list(userId)
      .then((loaded) => {
        if (!active) return;
        setMedicines(loaded);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setMedicines([]);
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [service, userId, enabled, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const add = useCallback(
    async (input: MedicineInput): Promise<SaveResult> => {
      try {
        const created = await service.add(userId, input);
        setMedicines((current) => [...current, created]);
        setChangeCount((count) => count + 1);
        return { ok: true };
      } catch (error) {
        return { ok: false, message: describeServiceError(error) };
      }
    },
    [service, userId],
  );

  const stop = useCallback(
    async (medicineId: string): Promise<SaveResult> => {
      try {
        await service.stop(userId, medicineId);
        const stoppedAt = new Date().toISOString();
        setMedicines((current) =>
          current.map((item) => (item.id === medicineId && item.stoppedAt === null ? { ...item, stoppedAt } : item)),
        );
        setChangeCount((count) => count + 1);
        return { ok: true };
      } catch (error) {
        return { ok: false, message: describeServiceError(error) };
      }
    },
    [service, userId],
  );

  return { status, medicines, retry, add, stop, changeCount };
}
