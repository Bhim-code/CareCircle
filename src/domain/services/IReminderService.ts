import type { Reminder } from '../entities/Reminder';

/**
 * Where a person's medication reminders come from.
 *
 * Every call is made for one specific person. An implementation must return
 * only that person's reminders and never anyone else's.
 */
export interface IReminderService {
  /** The reminders for one day. `day` is written YYYY-MM-DD, in the phone's local time. */
  listForDay(userId: string, day: string): Promise<readonly Reminder[]>;
}
