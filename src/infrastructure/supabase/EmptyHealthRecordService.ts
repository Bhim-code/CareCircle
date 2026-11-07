import type { DocumentUpload, HealthRecord } from '../../domain/entities/HealthRecord';
import type { Person } from '../../domain/entities/Person';
import type { IHealthRecordService } from '../../domain/services/IHealthRecordService';

/** Used when no backend address is set (and not in demo mode): there are no documents to show. */
export class EmptyHealthRecordService implements IHealthRecordService {
  async list(_userId: string): Promise<readonly HealthRecord[]> {
    return [];
  }

  async upload(_userId: string, _input: DocumentUpload): Promise<HealthRecord> {
    throw new Error('Documents are not available yet.');
  }

  async remove(_userId: string, _recordId: string): Promise<void> {
    throw new Error('Documents are not available yet.');
  }

  async freshLink(_userId: string, _recordId: string): Promise<string | null> {
    return null;
  }

  async clients(_userId: string): Promise<readonly Person[]> {
    return [];
  }
}
