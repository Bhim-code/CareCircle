import type { AccessView } from '../../domain/entities/AccessView';
import type { IAccessLogService } from '../../domain/services/IAccessLogService';

/** Used when no backend address is set (and not in demo mode): nobody has viewed anything. */
export class EmptyAccessLogService implements IAccessLogService {
  async list(_userId: string): Promise<readonly AccessView[]> {
    return [];
  }
}
