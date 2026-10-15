import { useCallback, useEffect, useState } from 'react';
import type { Reminder } from '../../domain/entities/Reminder';
import type { IReminderService } from '../../domain/services/IReminderService';

export type RemindersStatus = 'loading' | 'ready' | 'error';

/** Loads one person's reminders for one day, and lets the screen try again if loading fails. */
export function useReminders(service: IReminderService, userId: string, day: string, enabled = true) {
  const [status, setStatus] = useState<RemindersStatus>('loading');
  const [reminders, setReminders] = useState<readonly Reminder[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setStatus('loading');
    service
      .listForDay(userId, day)
      .then((loaded) => {
        if (!active) return;
        setReminders(loaded);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setReminders([]);
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [service, userId, day, enabled, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return { status, reminders, retry };
}
