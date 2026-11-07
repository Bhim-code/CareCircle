import { kindOfFile } from '../../application/documents';
import type { DocumentUpload, HealthRecord } from '../../domain/entities/HealthRecord';
import type { Person } from '../../domain/entities/Person';
import type { IHealthRecordService } from '../../domain/services/IHealthRecordService';
import { DEMO_PATIENT_ID } from './demoIds';

export const DEMO_RECORDS: readonly HealthRecord[] = [
  { id: 'r1', title: 'Blood pressure medicine', category: 'prescription', recordedOn: '2026-09-18' },
  { id: 'r2', title: 'Diabetes medicine renewal', category: 'prescription', recordedOn: '2026-06-02' },
  { id: 'r3', title: 'Full blood count', category: 'lab_report', recordedOn: '2026-08-21' },
  { id: 'r4', title: 'Kidney function test', category: 'lab_report', recordedOn: '2026-03-12' },
  { id: 'r5', title: 'Chest X-ray', category: 'imaging', recordedOn: '2026-01-30' },
  { id: 'r6', title: 'Hospital stay summary', category: 'discharge_summary', recordedOn: null },
];

/**
 * Made-up records for running the app with no server, so the screen can be
 * seen working. Only the demo patient has any; everyone else starts empty.
 * Used in development builds only.
 */
export class DemoHealthRecordService implements IHealthRecordService {
  private readonly byUser: Map<string, readonly HealthRecord[]>;
  private counter = 0;

  constructor(
    recordsByUser: ReadonlyMap<string, readonly HealthRecord[]> = new Map([[DEMO_PATIENT_ID, DEMO_RECORDS]]),
    private readonly latencyMs = 300,
  ) {
    this.byUser = new Map(recordsByUser);
  }

  async list(userId: string): Promise<readonly HealthRecord[]> {
    await this.pause();
    return this.byUser.get(userId) ?? [];
  }

  /** Only the demo patient can add documents. A new one is kept in memory, with the phone's own copy of the file. */
  async upload(userId: string, input: DocumentUpload): Promise<HealthRecord> {
    await this.pause();
    if (userId !== DEMO_PATIENT_ID) throw new DemoError(403, 'forbidden', 'Your account is not allowed to do this.');
    const kind = kindOfFile(input.file);
    if (kind === null) throw new DemoError(415, 'unsupported', 'That kind of file cannot be added. Use a PDF, JPEG, PNG or HEIC file.');
    this.counter += 1;
    const record: HealthRecord = {
      id: `demo-doc-${this.counter}`,
      title: input.title,
      category: input.category,
      recordedOn: input.recordedOn,
      patientId: userId,
      fileType: kind,
      fileName: input.file.name,
      sizeBytes: input.file.sizeBytes,
      fileUri: input.file.uri,
      uploadedBy: { id: userId, name: 'Ana Patient' },
      uploadedAt: new Date().toISOString(),
    };
    this.byUser.set(userId, [record, ...(this.byUser.get(userId) ?? [])]);
    return record;
  }

  async remove(userId: string, recordId: string): Promise<void> {
    await this.pause();
    const own = this.byUser.get(userId) ?? [];
    if (!own.some((record) => record.id === recordId)) throw new DemoError(404, 'not_found', 'Document not found.');
    this.byUser.set(userId, own.filter((record) => record.id !== recordId));
  }

  async freshLink(userId: string, recordId: string): Promise<string | null> {
    await this.pause();
    return (this.byUser.get(userId) ?? []).find((record) => record.id === recordId)?.fileUri ?? null;
  }

  async clients(_userId: string): Promise<readonly Person[]> {
    return [];
  }

  private async pause(): Promise<void> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
  }
}

/** An error with a code, like the API client's, so screens treat the demo and the real thing alike. */
class DemoError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DemoError';
  }
}
