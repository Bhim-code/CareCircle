import type { EntryAuthor, RecordEntry, RecordEntryInput } from '../../domain/entities/RecordEntry';
import type { IRecordEntryService } from '../../domain/services/IRecordEntryService';

/**
 * Placeholder for the real backend. There is no table for these entries (or
 * storage for photos) yet, so the list is always empty and saving is refused.
 *
 * TODO: replace with a SupabaseRecordEntryService once the backend has:
 *  - a record_entries table with row-level security (a patient sees their own,
 *    a caregiver sees the patient they are linked to);
 *  - a private storage bucket for medication photos, with the same rules.
 */
export class EmptyRecordEntryService implements IRecordEntryService {
  async list(_viewerId: string): Promise<readonly RecordEntry[]> {
    return [];
  }

  async add(_author: EntryAuthor, _input: RecordEntryInput): Promise<RecordEntry> {
    throw new Error('Saving records is not available yet.');
  }

  async update(_author: EntryAuthor, _entryId: string, _input: RecordEntryInput): Promise<RecordEntry> {
    throw new Error('Saving records is not available yet.');
  }
}
