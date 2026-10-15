import type { HealthRecord } from '../entities/HealthRecord';

/**
 * Where a person's health records come from.
 *
 * Every call is made for one specific person. An implementation must return
 * only that person's records and never anyone else's.
 */
export interface IHealthRecordService {
  list(userId: string): Promise<readonly HealthRecord[]>;
}
