import type { DocumentUpload, HealthRecord, HealthRecordCategory, PickedFile } from '../../domain/entities/HealthRecord';
import { HEALTH_RECORD_CATEGORIES } from '../../domain/entities/HealthRecord';
import type { Person } from '../../domain/entities/Person';
import type { IHealthRecordService } from '../../domain/services/IHealthRecordService';
import { ApiClient } from './ApiClient';
import { ApiError } from './ApiError';

function badAnswer(): ApiError {
  return new ApiError(200, 'bad_response', 'The server sent something the app could not read.');
}

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw badAnswer();
  return value;
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Reads one document as the backend sends it (HealthDocumentOut in backend/app/api/routes/health_records.py). */
export function toHealthRecord(value: unknown): HealthRecord {
  if (!isRow(value)) throw badAnswer();
  const category = value.category;
  if (typeof category !== 'string' || !(HEALTH_RECORD_CATEGORIES as readonly string[]).includes(category)) throw badAnswer();
  const recordedOn = textOrNull(value.recordedOn);
  if (recordedOn !== null && !DAY.test(recordedOn)) throw badAnswer();
  const fileType = value.fileType;
  if (!(fileType === null || fileType === undefined || fileType === 'pdf' || fileType === 'image')) throw badAnswer();
  const size = value.sizeBytes;
  if (!(size === null || size === undefined || (typeof size === 'number' && Number.isFinite(size)))) throw badAnswer();
  let uploadedBy: Person | null = null;
  if (value.uploadedBy !== null && value.uploadedBy !== undefined) {
    if (!isRow(value.uploadedBy)) throw badAnswer();
    uploadedBy = { id: text(value.uploadedBy.id), name: text(value.uploadedBy.name) };
  }
  return {
    id: text(value.id),
    title: text(value.title),
    category: category as HealthRecordCategory,
    recordedOn,
    patientId: text(value.patientId),
    fileType: fileType ?? null,
    fileName: textOrNull(value.fileName),
    sizeBytes: typeof size === 'number' ? size : null,
    fileUri: textOrNull(value.fileUri),
    uploadedBy,
    uploadedAt: text(value.uploadedAt),
  };
}

/** How a file is added to the form. On the phone it is an object with the file's address, not the bytes. */
export type AppendFile = (form: FormData, file: PickedFile) => void;

const appendPhoneFile: AppendFile = (form, file) => {
  // React Native reads the file itself from its address when the form is sent.
  form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as unknown as Blob);
};

/** Uploading a document can take a while on a slow connection. */
const UPLOAD_TIMEOUT_MS = 90_000;

/** Health documents against the CareCircle backend (backend/app/api/routes/health_records.py). */
export class HttpHealthRecordService implements IHealthRecordService {
  constructor(
    private readonly api: ApiClient,
    private readonly appendFile: AppendFile = appendPhoneFile,
  ) {}

  async list(_userId: string): Promise<readonly HealthRecord[]> {
    const answer = await this.api.get<unknown>('/health-records');
    if (!Array.isArray(answer)) throw badAnswer();
    // One unreadable document must not be quietly left out of a health list.
    return answer.map((item) => this.withFullLink(toHealthRecord(item)));
  }

  async upload(_userId: string, input: DocumentUpload): Promise<HealthRecord> {
    const form = new FormData();
    this.appendFile(form, input.file);
    form.append('title', input.title);
    form.append('category', input.category);
    if (input.recordedOn) form.append('recordedOn', input.recordedOn);
    if (input.patientId) form.append('patientId', input.patientId);
    return this.withFullLink(toHealthRecord(await this.api.post<unknown>('/health-records', form, { timeoutMs: UPLOAD_TIMEOUT_MS })));
  }

  async remove(_userId: string, recordId: string): Promise<void> {
    await this.api.delete<void>(`/health-records/${encodeURIComponent(recordId)}`);
  }

  private withFullLink(record: HealthRecord): HealthRecord {
    return record.fileUri ? { ...record, fileUri: this.api.absoluteUrl(record.fileUri) } : record;
  }

  /** Links expire after about 15 minutes, so ask the list again for a new one. */
  async freshLink(userId: string, recordId: string): Promise<string | null> {
    const records = await this.list(userId);
    return records.find((record) => record.id === recordId)?.fileUri ?? null;
  }

  /** The people with an active care link to this person. For a caregiver that is their clients. */
  async clients(_userId: string): Promise<readonly Person[]> {
    const answer = await this.api.get<unknown>('/care-links');
    if (!Array.isArray(answer)) throw badAnswer();
    const seen = new Map<string, Person>();
    for (const link of answer) {
      if (!isRow(link) || link.status !== 'active' || !isRow(link.patient)) continue;
      const id = text(link.patient.id);
      if (!seen.has(id)) seen.set(id, { id, name: text(link.patient.name) });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
