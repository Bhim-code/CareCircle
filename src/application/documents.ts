import type { DocumentUpload, HealthRecord, HealthRecordCategory, PickedFile } from '../domain/entities/HealthRecord';
import { parseDateText } from './recordEntries';
import { dayKey } from './reminders';

/** The backend refuses anything bigger. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TITLE_LENGTH = 200;

// The permission codes live in permissions.ts. They are still offered from here.
export { DOCUMENTS_UPLOAD, DOCUMENTS_VIEW } from './permissions';

export type FileKind = 'pdf' | 'image';

const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/heif'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif'];

/** What kind of allowed file this is (a PDF, or a JPEG, PNG or HEIC photo), or null if it is not allowed. */
export function kindOfFile(file: Pick<PickedFile, 'name' | 'mimeType'>): FileKind | null {
  const type = (file.mimeType ?? '').toLowerCase();
  if (type === 'application/pdf') return 'pdf';
  if (IMAGE_TYPES.includes(type)) return 'image';
  // Some phones do not say what a file is. Fall back on the ending of its name.
  if (type === '' || type === 'application/octet-stream') {
    const extension = file.name.toLowerCase().split('.').pop() ?? '';
    if (extension === 'pdf') return 'pdf';
    if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  }
  return null;
}

/** "850 KB", "2.3 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "PDF · 2.3 MB", "Photo · 850 KB", or "Details only" for a document with no file. */
export function fileSummary(record: HealthRecord): string {
  if (!record.fileType) return 'Details only';
  const label = record.fileType === 'pdf' ? 'PDF' : 'Photo';
  return typeof record.sizeBytes === 'number' ? `${label} · ${formatSize(record.sizeBytes)}` : label;
}

export interface UploadDraft {
  title: string;
  category: HealthRecordCategory | '';
  /** YYYY-MM-DD, or empty for no date. */
  recordedOn: string;
  file: PickedFile | null;
  patientId?: string;
}

export interface UploadErrors {
  title?: string;
  category?: string;
  recordedOn?: string;
  file?: string;
  patientId?: string;
}

export type UploadCheck =
  | { readonly ok: true; readonly input: DocumentUpload }
  | { readonly ok: false; readonly errors: UploadErrors };

/**
 * Checks the form the same way the backend will, so the person is told what to fix
 * before a big file is sent. The backend still checks again.
 * `needsClient` is true for a caregiver who has several clients and must pick one.
 */
export function validateUpload(draft: UploadDraft, now: Date, needsClient = false): UploadCheck {
  const errors: UploadErrors = {};

  const title = draft.title.trim();
  if (title === '') errors.title = 'Give the document a title.';
  else if (title.length > MAX_TITLE_LENGTH) errors.title = `Please keep the title under ${MAX_TITLE_LENGTH} characters.`;

  if (draft.category === '') errors.category = 'Choose what kind of document this is.';

  let recordedOn: string | null = null;
  if (draft.recordedOn.trim() !== '') {
    const parsed = parseDateText(draft.recordedOn);
    if (!parsed) {
      errors.recordedOn = 'Write the date like 2026-10-29, or leave it empty.';
    } else {
      const pad = (n: number) => String(n).padStart(2, '0');
      recordedOn = `${parsed.year}-${pad(parsed.month)}-${pad(parsed.day)}`;
      if (recordedOn > dayKey(now)) errors.recordedOn = 'The date cannot be in the future.';
    }
  }

  if (!draft.file) {
    errors.file = 'Choose a photo or a PDF first.';
  } else if (kindOfFile(draft.file) === null) {
    errors.file = 'Only PDF, JPEG, PNG or HEIC files can be added.';
  } else if (draft.file.sizeBytes !== null && draft.file.sizeBytes > MAX_FILE_BYTES) {
    errors.file = `This file is ${formatSize(draft.file.sizeBytes)}. The most allowed is 10 MB.`;
  }

  if (needsClient && !draft.patientId) errors.patientId = 'Choose who this document is for.';

  if (Object.keys(errors).length > 0 || draft.category === '' || !draft.file) return { ok: false, errors };
  return {
    ok: true,
    input: {
      title,
      category: draft.category,
      recordedOn,
      ...(draft.patientId ? { patientId: draft.patientId } : {}),
      file: draft.file,
    },
  };
}

/** The patient, or the person who uploaded it, can delete a document. */
export function canDelete(record: HealthRecord, userId: string): boolean {
  return record.patientId === userId || record.uploadedBy?.id === userId;
}

/**
 * A sentence for a failed upload, delete or open. It reads only the error's `code`,
 * `status` and `message`, so it works for any backend. The backend's own sentence is
 * used for a refused file, because it says exactly what is wrong with it.
 */
export function describeDocumentError(error: unknown): string {
  const read = (key: string): unknown =>
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>)[key] : undefined;
  const code = typeof read('code') === 'string' ? (read('code') as string) : '';
  const status = typeof read('status') === 'number' ? (read('status') as number) : 0;
  const message = typeof read('message') === 'string' ? (read('message') as string) : '';
  const fields = read('fields');
  const fileProblem =
    typeof fields === 'object' && fields !== null && typeof (fields as Record<string, unknown>).file === 'string'
      ? ((fields as Record<string, string>).file)
      : '';

  if (code === 'network' || code === 'timeout') return 'Cannot reach the server. Check your connection and try again.';
  if (code === 'too_many_requests') return 'Too many uploads for now. Please try again later.';
  if (code === 'session_expired' || code === 'unauthenticated') return 'Your sign-in has ended. Please sign in again.';
  if (status === 413) return 'That file is too big. The most allowed is 10 MB.';
  if (status === 415) return fileProblem || message || 'That kind of file cannot be added. Use a PDF, JPEG, PNG or HEIC file.';
  if (code === 'missing_permission') return 'Your account is not allowed to do this.';
  if (code === 'forbidden') return 'Your account is not allowed to do this.';
  if (status === 404) return 'That document is no longer there. Refresh the list.';
  if (status === 422 && (fileProblem || message)) return fileProblem || message;
  return 'We could not save that. Please try again.';
}
