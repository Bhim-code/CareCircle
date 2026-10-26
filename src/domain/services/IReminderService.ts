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

  /**
   * Records that the person confirmed they took this medicine. Called only
   * when the person presses the button, never automatically.
   */
  acknowledge(userId: string, reminderId: string): Promise<void>;

  /** Records that the person chose to skip this dose. Called only when they press "Skip". */
  skip(userId: string, reminderId: string): Promise<void>;
}
