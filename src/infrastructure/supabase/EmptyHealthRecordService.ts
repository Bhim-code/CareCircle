import type { HealthRecord } from '../../domain/entities/HealthRecord';
import type { IHealthRecordService } from '../../domain/services/IHealthRecordService';

/**
 * Placeholder for the real backend. The database has no health-records table
 * yet, so there is nothing to read and the list is always empty.
 *
 * TODO: replace with a SupabaseHealthRecordService once a health_records table
 * exists with row-level security, so each person can only read their own rows.
 */
export class EmptyHealthRecordService implements IHealthRecordService {
  async list(_userId: string): Promise<readonly HealthRecord[]> {
    return [];
  }
}
