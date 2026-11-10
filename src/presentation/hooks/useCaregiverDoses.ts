import { useCallback, useEffect, useState } from 'react';
import { describeDosesError, sortDoses } from '../../application/caregiverDoses';
import type { PatientDose } from '../../domain/entities/PatientDose';
import type { ICaregiverDoseService } from '../../domain/services/ICaregiverDoseService';

export type CaregiverDosesStatus = 'loading' | 'ready' | 'error';

/** How often the list is loaded again while the screen is open, so a missed dose shows up. */
export const DOSES_REFRESH_MS = 2 * 60_000;

/** Loads the doses of the patients a caregiver looks after, for one day, and keeps them fresh. */
export function useCaregiverDoses(service: ICaregiverDoseService, day: string, enabled = true) {
  const [status, setStatus] = useState<CaregiverDosesStatus>('loading');
  const [doses, setDoses] = useState<readonly PatientDose[]>([]);
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let first = true;

    const load = () => {
      // Only the first load shows "Loading"; later ones swap the list in quietly.
      if (first) setStatus('loading');
      service
        .listForDay(day)
        .then((loaded) => {
          if (!active) return;
          setDoses(sortDoses(loaded));
          setStatus('ready');
        })
        .catch((error) => {
          if (!active) return;
          // A failed quiet refresh keeps what is on screen; only a failed first load is an error.
          if (first) {
            setDoses([]);
            setMessage(describeDosesError(error));
            setStatus('error');
          }
        })
        .finally(() => {
          first = false;
        });
    };

    load();
    const timer = setInterval(load, DOSES_REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [service, day, enabled, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { status, doses, message, retry };
}
