import type { Person } from '../../domain/entities/Person';
import type { EntryAuthor, RecordEntry, RecordEntryInput } from '../../domain/entities/RecordEntry';
import type { IRecordEntryService } from '../../domain/services/IRecordEntryService';

/** Used when no backend address is set (and not in demo mode): there are no records to show. */
export class EmptyRecordEntryService implements IRecordEntryService {
  async list(_viewerId: string): Promise<readonly RecordEntry[]> {
    return [];
  }

  async add(_author: EntryAuthor, _input: RecordEntryInput): Promise<RecordEntry> {
    throw new Error('Written records are not available yet.');
  }

  async update(_author: EntryAuthor, _entryId: string, _input: RecordEntryInput): Promise<RecordEntry> {
    throw new Error('Written records are not available yet.');
  }

  async clients(_viewerId: string): Promise<readonly Person[]> {
    return [];
  }
}
