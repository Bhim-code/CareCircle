import type { Medicine, MedicineInput } from '../entities/Medicine';

/**
 * Where a person's medicines are kept.
 *
 * Every call is made for one specific person. An implementation must only ever
 * read or change that person's own medicines.
 */
export interface IMedicineService {
  /** All the medicines, including stopped ones (they stay as history). */
  list(userId: string): Promise<readonly Medicine[]>;

  /** Adds a medicine. Its doses start from now (never for a time that has already passed today). */
  add(userId: string, input: MedicineInput): Promise<Medicine>;

  /**
   * Stops a medicine from now on. Doses already taken or past stay as history;
   * later doses are removed. Stopping twice is harmless.
   */
  stop(userId: string, medicineId: string): Promise<void>;
}
