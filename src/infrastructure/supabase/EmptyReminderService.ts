import type { Reminder } from '../../domain/entities/Reminder';
import type { IReminderService } from '../../domain/services/IReminderService';

/**
 * Placeholder for the real backend. The database has no reminders table yet,
 * so there is nothing to read and the list is always empty.
 *
 * TODO: replace with a SupabaseReminderService once a reminders table exists
 * with row-level security, so each person can only read their own rows.
 */
export class EmptyReminderService implements IReminderService {
  async listForDay(_userId: string, _day: string): Promise<readonly Reminder[]> {
    return [];
  }
}
