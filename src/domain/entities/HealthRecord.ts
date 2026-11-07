import type { Person } from './Person';

/** The kinds of document a person can keep. "other" catches everything else. */
export const HEALTH_RECORD_CATEGORIES = [
  'prescription',
  'lab_report',
  'imaging',
  'discharge_summary',
  'other',
] as const;

export type HealthRecordCategory = (typeof HEALTH_RECORD_CATEGORIES)[number];

/**
 * One document in a person's health history. The first four fields are always known.
 * The rest come from the backend once a file can be uploaded; they are missing for
 * demo data that has no file.
 */
export interface HealthRecord {
  readonly id: string;
  readonly title: string;
  readonly category: HealthRecordCategory;
  /** The date on the document, as YYYY-MM-DD. Null when it is not known. */
  readonly recordedOn: string | null;
  /** Who the document is about. */
  readonly patientId?: string;
  /** "pdf" or "image", or null for a document that is only details with no file. */
  readonly fileType?: 'pdf' | 'image' | null;
  readonly fileName?: string | null;
  readonly sizeBytes?: number | null;
  /** A link that opens the file. It works for about 15 minutes, so ask for a fresh one when opening. */
  readonly fileUri?: string | null;
  readonly uploadedBy?: Person | null;
  /** ISO date and time. */
  readonly uploadedAt?: string;
}

/** A file the person picked on the phone, before it is sent. */
export interface PickedFile {
  /** Where the phone keeps it (a file: or content: address). */
  readonly uri: string;
  readonly name: string;
  /** Such as "application/pdf" or "image/jpeg". Can be missing for some files. */
  readonly mimeType: string | null;
  /** In bytes. Can be missing, in which case the server checks the size. */
  readonly sizeBytes: number | null;
}

/** What is needed to add a document. */
export interface DocumentUpload {
  readonly title: string;
  readonly category: HealthRecordCategory;
  /** YYYY-MM-DD, or null when the document has no date. */
  readonly recordedOn: string | null;
  /** For a caregiver with more than one client: which one. */
  readonly patientId?: string;
  readonly file: PickedFile;
}
