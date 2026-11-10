import type { Reminder } from './Reminder';

/** One dose for one of the patients a caregiver looks after. Read-only for the caregiver. */
export interface PatientDose extends Reminder {
  readonly patientId: string;
  readonly patientName: string;
}
