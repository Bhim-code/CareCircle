import type { PatientDose } from '../../domain/entities/PatientDose';
import type { ICaregiverDoseService } from '../../domain/services/ICaregiverDoseService';

/** Used when no backend address is set (and not in demo mode): there are no patients' doses. */
export class EmptyCaregiverDoseService implements ICaregiverDoseService {
  async listForDay(_day: string): Promise<readonly PatientDose[]> {
    return [];
  }
}
