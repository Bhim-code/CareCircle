import type { AccessView } from '../../domain/entities/AccessView';
import type { IAccessLogService } from '../../domain/services/IAccessLogService';

const HOUR = 3_600_000;

/** A small made-up list, so the screen can be tried without a backend. */
export class DemoAccessLogService implements IAccessLogService {
  constructor(private readonly now: () => number = Date.now) {}

  async list(_userId: string): Promise<readonly AccessView[]> {
    const at = (hoursAgo: number) => new Date(this.now() - hoursAgo * HOUR).toISOString();
    const sam = { id: 'demo-caregiver@demo.test', name: 'Sam Caregiver', role: 'caregiver' };
    const sue = { id: 'demo-supervisor@demo.test', name: 'Sue Supervisor', role: 'supervisor' };
    return [
      { at: at(1), viewer: sam, action: 'entries.list' },
      { at: at(3), viewer: sam, action: 'tasks.list' },
      { at: at(27), viewer: sue, action: 'documents.list' },
      { at: at(30), viewer: sam, action: 'tasks.complete' },
    ];
  }
}
