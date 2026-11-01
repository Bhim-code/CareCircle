import type { Medicine, MedicineInput } from '../../domain/entities/Medicine';
import type { IMedicineService } from '../../domain/services/IMedicineService';
import { DEMO_PATIENT_ID } from './demoIds';

// The demo patient's medicines at the start: [name, time]. They match the demo reminders.
const SEED: readonly (readonly [string, string])[] = [
  ['Blood pressure tablet', '08:00'],
  ['Metformin', '13:00'],
  ['Vitamin D', '18:30'],
  ['Evening heart tablet', '21:00'],
];

/**
 * Made-up medicines for running the app with no server. Only the demo patient has any;
 * everyone else starts empty. Used in development builds only. Changes are lost on reload.
 */
export class DemoMedicineService implements IMedicineService {
  private medicines: Medicine[] = SEED.map(([name, time], index) => ({
    id: `demo-med-${index + 1}`,
    name,
    times: [time],
    startDate: '2020-01-01',
    endDate: null,
    stoppedAt: null,
  }));
  /** When each medicine was added. The demo reminders use it, like the real backend: no doses before that. */
  private readonly addedAt = new Map<string, number>();
  private counter = SEED.length;

  constructor(private readonly latencyMs = 300) {}

  async list(userId: string): Promise<readonly Medicine[]> {
    await this.pause();
    return userId === DEMO_PATIENT_ID ? [...this.medicines] : [];
  }

  async add(userId: string, input: MedicineInput): Promise<Medicine> {
    await this.pause();
    if (userId !== DEMO_PATIENT_ID) throw new Error('Medicines are not available for this account.');
    this.counter += 1;
    const medicine: Medicine = {
      id: `demo-med-${this.counter}`,
      name: input.name,
      times: [...input.times].sort(),
      startDate: input.startDate,
      endDate: input.endDate,
      stoppedAt: null,
    };
    this.medicines = [...this.medicines, medicine];
    this.addedAt.set(medicine.id, Date.now());
    return medicine;
  }

  async stop(userId: string, medicineId: string): Promise<void> {
    await this.pause();
    if (userId !== DEMO_PATIENT_ID) throw new Error('Medicine not found.');
    const found = this.medicines.find((medicine) => medicine.id === medicineId);
    if (!found) throw new Error('Medicine not found.');
    if (found.stoppedAt !== null) return;
    const stopped: Medicine = { ...found, stoppedAt: new Date().toISOString() };
    this.medicines = this.medicines.map((medicine) => (medicine.id === medicineId ? stopped : medicine));
  }

  /** For the demo reminders: every medicine the demo patient has, right now. */
  snapshot(): readonly Medicine[] {
    return this.medicines;
  }

  /** For the demo reminders: when a medicine was added (0 for the starting ones). */
  addedAtMs(medicineId: string): number {
    return this.addedAt.get(medicineId) ?? 0;
  }

  private pause(): Promise<void> {
    return this.latencyMs > 0 ? new Promise((resolve) => setTimeout(resolve, this.latencyMs)) : Promise.resolve();
  }
}
