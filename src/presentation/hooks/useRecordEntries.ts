import { useCallback, useEffect, useState } from 'react';
import { describeEntryError } from '../../application/recordEntries';
import type { Person } from '../../domain/entities/Person';
import type { EntryAuthor, RecordEntry, RecordEntryInput } from '../../domain/entities/RecordEntry';
import type { IRecordEntryService } from '../../domain/services/IRecordEntryService';

export type EntriesStatus = 'loading' | 'ready' | 'error';

/** The saved entry, or a sentence that says why it could not be saved. */
export type SaveResult = { ok: true; entry: RecordEntry } | { ok: false; message: string };

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

  /** Saves a new entry. On failure the result carries a sentence for the person. */
  const add = useCallback(
    async (author: EntryAuthor, input: RecordEntryInput): Promise<SaveResult> => {
      try {
        const saved = await service.add(author, input);
        setEntries((current) => [...current, saved]);
        return { ok: true, entry: saved };
      } catch (error) {
        return { ok: false, message: describeEntryError(error) };
      }
    },
    [service],
  );

  const update = useCallback(
    async (author: EntryAuthor, entryId: string, input: RecordEntryInput): Promise<SaveResult> => {
      try {
        const saved = await service.update(author, entryId, input);
        setEntries((current) => current.map((item) => (item.id === entryId ? saved : item)));
        return { ok: true, entry: saved };
      } catch (error) {
        return { ok: false, message: describeEntryError(error) };
      }
    },
    [service],
  );

  /** The people this person can write records about. Empty if that cannot be loaded. */
  const clients = useCallback(async (): Promise<readonly Person[]> => {
    try {
      return await service.clients(viewerId);
    } catch {
      return [];
    }
  }, [service, viewerId]);

  return { status, entries, retry, add, update, clients };
}
