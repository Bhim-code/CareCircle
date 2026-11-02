import type { Medicine, MedicineInput } from '../../domain/entities/Medicine';
import type { IMedicineService } from '../../domain/services/IMedicineService';

/** Used when no backend address is set (and not in demo mode): there are no medicines to show. */
export class EmptyMedicineService implements IMedicineService {
  async list(_userId: string): Promise<readonly Medicine[]> {
    return [];
  }

  async add(_userId: string, _input: MedicineInput): Promise<Medicine> {
    throw new Error('Medicines are not available yet.');
  }

  async stop(_userId: string, _medicineId: string): Promise<void> {
    throw new Error('Medicines are not available yet.');
  }
}
