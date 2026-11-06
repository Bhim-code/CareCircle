import type { DocumentUpload, HealthRecord } from '../entities/HealthRecord';
import type { Person } from '../entities/Person';

/**
 * Where a person's health records come from, and how documents are added and removed.
 *
 * Every call is made for one specific person. An implementation must return
 * only what that person may see and never anyone else's.
 */
export interface IHealthRecordService {
  list(userId: string): Promise<readonly HealthRecord[]>;
  /** Sends a new document. Answers with the saved record. */
  upload(userId: string, input: DocumentUpload): Promise<HealthRecord>;
  /** Removes a document from the lists. */
  remove(userId: string, recordId: string): Promise<void>;
  /** A fresh link that opens the document's file, or null when it has no file. Links expire after a few minutes. */
  freshLink(userId: string, recordId: string): Promise<string | null>;
  /** The people the person may add documents for. A caregiver with several clients picks from this. */
  clients(userId: string): Promise<readonly Person[]>;
}
