import { useCallback, useEffect, useState } from 'react';
import type { Reminder } from '../../domain/entities/Reminder';
import type { IReminderService } from '../../domain/services/IReminderService';

export type RemindersStatus = 'loading' | 'ready' | 'error';

/** Loads one person's reminders for one day. Lets the screen try again and confirm a dose. */
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

  /** Confirms one dose. Returns false if it could not be saved, so the screen can say so. */
  const acknowledge = useCallback(
    async (reminderId: string): Promise<boolean> => {
      try {
        await service.acknowledge(userId, reminderId);
      } catch {
        return false;
      }
      setReminders((current) =>
        current.map((item) => (item.id === reminderId ? { ...item, acknowledged: true } : item)),
      );
      return true;
    },
    [service, userId],
  );

  return { status, reminders, retry, acknowledge };
}
