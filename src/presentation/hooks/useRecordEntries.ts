import { useCallback, useEffect, useState } from 'react';
import type { EntryAuthor, RecordEntry, RecordEntryInput } from '../../domain/entities/RecordEntry';
import type { IRecordEntryService } from '../../domain/services/IRecordEntryService';

export type EntriesStatus = 'loading' | 'ready' | 'error';

/** Loads the written records the person can see, and saves new ones or changes to old ones. */
export function useRecordEntries(service: IRecordEntryService, viewerId: string, enabled = true) {
  const [status, setStatus] = useState<EntriesStatus>('loading');
  const [entries, setEntries] = useState<readonly RecordEntry[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setStatus('loading');
    service
      .list(viewerId)
      .then((loaded) => {
        if (!active) return;
        setEntries(loaded);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setEntries([]);
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [service, viewerId, enabled, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  /** Returns the saved entry, or null if it could not be saved so the screen can say so. */
  const add = useCallback(
    async (author: EntryAuthor, input: RecordEntryInput): Promise<RecordEntry | null> => {
      try {
        const saved = await service.add(author, input);
        setEntries((current) => [...current, saved]);
        return saved;
      } catch {
        return null;
      }
    },
    [service],
  );

  const update = useCallback(
    async (author: EntryAuthor, entryId: string, input: RecordEntryInput): Promise<RecordEntry | null> => {
      try {
        const saved = await service.update(author, entryId, input);
        setEntries((current) => current.map((item) => (item.id === entryId ? saved : item)));
        return saved;
      } catch {
        return null;
      }
    },
    [service],
  );

  return { status, entries, retry, add, update };
}
