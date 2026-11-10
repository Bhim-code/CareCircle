import type { PatientDose } from '../entities/PatientDose';

/**
 * The doses of the patients a caregiver looks after. A caregiver can only read them: they
 * never confirm or skip a dose for someone else. Rejects with an error that has a `code`,
 * for example "network".
 */
export interface ICaregiverDoseService {
  /** Every linked patient's doses for one day (YYYY-MM-DD, phone local time), earliest first. */
  listForDay(day: string): Promise<readonly PatientDose[]>;
}
