import type { HealthRecord } from '../../domain/entities/HealthRecord';
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
  constructor(
    private readonly recordsByUser: ReadonlyMap<string, readonly HealthRecord[]> = new Map([
      [DEMO_PATIENT_ID, DEMO_RECORDS],
    ]),
    private readonly latencyMs = 300,
  ) {}

  async list(userId: string): Promise<readonly HealthRecord[]> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    return this.recordsByUser.get(userId) ?? [];
  }
}
