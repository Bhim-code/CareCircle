import type { ClientDay, ExtraInput, ExtraWork, MarkInput } from '../../domain/entities/CareTask';
import type { ICareTaskService } from '../../domain/services/ICareTaskService';

/** Used when no backend address is set (and not in demo mode): there are no tasks to show. */
export class EmptyCareTaskService implements ICareTaskService {
  async listDay(_userId: string, _day?: string): Promise<readonly ClientDay[]> {
    return [];
  }

  async mark(_userId: string, _taskId: string, _day: string, _input: MarkInput): Promise<ClientDay> {
    throw new Error('Care tasks are not available yet.');
  }

  async undo(_userId: string, _taskId: string, _day: string): Promise<void> {
    throw new Error('Care tasks are not available yet.');
  }

  async addExtra(_userId: string, _input: ExtraInput): Promise<ExtraWork> {
    throw new Error('Care tasks are not available yet.');
  }
}
