import { useCallback, useEffect, useState } from 'react';
import { describeTaskError, replaceDay } from '../../application/careTasks';
import type { ClientDay, ExtraInput, MarkInput } from '../../domain/entities/CareTask';
import type { ICareTaskService } from '../../domain/services/ICareTaskService';

export type CareTasksStatus = 'loading' | 'ready' | 'error';

/** Either it worked, or a sentence the screen can show about why it did not. */
export type TaskResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** Loads today's care tasks for one person's clients, and lets the screens mark, undo and add extra work. */
export function useCareTasks(service: ICareTaskService, userId: string, enabled = true) {
  const [status, setStatus] = useState<CareTasksStatus>('loading');
  const [days, setDays] = useState<readonly ClientDay[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    service
      .listDay(userId)
      .then((loaded) => {
        if (!active) return;
        setDays(loaded);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        // Keep what is already on screen if a refresh fails; only a first load shows the error page.
        setStatus((current) => (current === 'ready' ? current : 'error'));
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [service, userId, enabled, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  const refresh = useCallback(() => {
    setRefreshing(true);
    setAttempt((count) => count + 1);
  }, []);

  const mark = useCallback(
    async (taskId: string, day: string, input: MarkInput): Promise<TaskResult> => {
      try {
        const updated = await service.mark(userId, taskId, day, input);
        setDays((current) => replaceDay(current, updated));
        return { ok: true };
      } catch (error) {
        return { ok: false, message: describeTaskError(error) };
      }
    },
    [service, userId],
  );

  const undo = useCallback(
    async (taskId: string, day: string): Promise<TaskResult> => {
      try {
        await service.undo(userId, taskId, day);
        setAttempt((count) => count + 1); // the server answers with nothing, so ask again
        return { ok: true };
      } catch (error) {
        return { ok: false, message: describeTaskError(error) };
      }
    },
    [service, userId],
  );

  const addExtra = useCallback(
    async (input: ExtraInput): Promise<TaskResult> => {
      try {
        await service.addExtra(userId, input);
        setAttempt((count) => count + 1);
        return { ok: true };
      } catch (error) {
        return { ok: false, message: describeTaskError(error) };
      }
    },
    [service, userId],
  );

  return { status, days, refreshing, retry, refresh, mark, undo, addExtra };
}
