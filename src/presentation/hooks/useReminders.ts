import { useCallback, useEffect, useState } from 'react';
import type { Reminder } from '../../domain/entities/Reminder';
import type { IReminderService } from '../../domain/services/IReminderService';

export type RemindersStatus = 'loading' | 'ready' | 'error';

/** Loads one person's reminders for one day. Lets the screen try again and confirm a dose. */
/** True when the server says this dose was already marked as taken (409 already_taken). */
export function isAlreadyTaken(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'already_taken';
}

export function useReminders(
  service: IReminderService,
  userId: string,
  day: string,
  enabled = true,
  /** Changes when the doses may have changed (a medicine was added or stopped), to load them again. */
  refreshKey = 0,
) {
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
  }, [service, userId, day, enabled, attempt, refreshKey]);

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

  /** Records that the person skipped one dose. Returns false if it could not be saved. */
  const skip = useCallback(
    async (reminderId: string): Promise<boolean> => {
      try {
        await service.skip(userId, reminderId);
      } catch (error) {
        // The dose was already taken (on another phone, say): it is done, so show it as taken.
        if (isAlreadyTaken(error)) {
          setReminders((current) =>
            current.map((item) => (item.id === reminderId ? { ...item, acknowledged: true, skipped: false } : item)),
          );
          return true;
        }
        return false;
      }
      setReminders((current) =>
        current.map((item) => (item.id === reminderId ? { ...item, skipped: true } : item)),
      );
      return true;
    },
    [service, userId],
  );

  return { status, reminders, retry, acknowledge, skip };
}
