/** Where a reminder stands right now. Worked out from the time, never stored. */
export type ReminderStatus = 'upcoming' | 'due' | 'acknowledged' | 'skipped' | 'missed';

/** One medicine to take at one time on one day. */
export interface Reminder {
  readonly id: string;
  readonly medicineName: string;
  /** When the medicine should be taken, as an ISO date-time string. */
  readonly scheduledAt: string;
  /** True only after the person has pressed "I took it". Never guessed. */
  readonly acknowledged: boolean;
  /** True after the person pressed "Skip" on purpose. Not the same as missed. */
  readonly skipped?: boolean;
}
