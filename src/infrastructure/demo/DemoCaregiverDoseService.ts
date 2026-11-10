import type { PatientDose } from '../../domain/entities/PatientDose';
import type { ICaregiverDoseService } from '../../domain/services/ICaregiverDoseService';
import { DEMO_PATIENT_ID } from './demoIds';

// Made-up doses: [patient id, patient name, medicine, hour, minute, taken?]
const SAMPLE: readonly (readonly [string, string, string, number, number, boolean])[] = [
  [DEMO_PATIENT_ID, 'Ana Patient', 'Blood pressure tablet', 8, 0, true],
  ['demo-patient-2@demo.test', 'Bob Patient', 'Insulin', 8, 30, false],
  [DEMO_PATIENT_ID, 'Ana Patient', 'Metformin', 13, 0, false],
  ['demo-patient-2@demo.test', 'Bob Patient', 'Vitamin D', 18, 30, false],
  [DEMO_PATIENT_ID, 'Ana Patient', 'Evening heart tablet', 21, 0, false],
];

/** A small made-up list, so the caregiver's home can be tried without a backend. */
export class DemoCaregiverDoseService implements ICaregiverDoseService {
  constructor(private readonly latencyMs: number = 300) {}

  async listForDay(day: string): Promise<readonly PatientDose[]> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    const [year, month, date] = day.split('-').map(Number);
    return SAMPLE.map(([patientId, patientName, medicineName, hour, minute, taken], index) => ({
      id: `${day}-c${index}`,
      patientId,
      patientName,
      medicineName,
      scheduledAt: new Date(year, month - 1, date, hour, minute).toISOString(),
      acknowledged: taken,
      skipped: false,
    }));
  }
}
