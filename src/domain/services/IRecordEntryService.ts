import type { EntryAuthor, RecordEntry, RecordEntryInput } from '../entities/RecordEntry';

/**
 * Where a person's written records (incidents, medical, behavioural and
 * medication notes) are kept.
 *
 * Entries belong to the patient. A patient sees their own; a caregiver sees
 * those of the patient they look after. An implementation must never return
 * anyone else's.
 */
export interface IRecordEntryService {
  list(viewerId: string): Promise<readonly RecordEntry[]>;

  /** Saves a new entry. The service sets the id and the recorded time. */
  add(author: EntryAuthor, input: RecordEntryInput): Promise<RecordEntry>;

  /** Replaces the details of an entry and marks it edited. The recorded time never changes. */
  update(author: EntryAuthor, entryId: string, input: RecordEntryInput): Promise<RecordEntry>;
}
