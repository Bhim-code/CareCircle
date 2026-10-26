/** The ids of the buttons shown on an alarm notification. */
export const ALARM_ACTION = {
  taken: 'carecircle.alarm.taken',
  snooze: 'carecircle.alarm.snooze',
  skip: 'carecircle.alarm.skip',
} as const;

/** The notification category that carries those three buttons. */
export const ALARM_CATEGORY = 'carecircle.dose';

/** What happened to an alarm: the person pressed a button, or just opened it. */
export type AlarmEventKind = 'open' | 'taken' | 'snooze' | 'skip';

export interface AlarmEvent {
  readonly kind: AlarmEventKind;
  readonly reminderId: string;
  readonly medicineName: string;
  /** When the alarm started ringing (milliseconds), so a late opening stays silent. */
  readonly fireAt: number | null;
}

/** The test alarm rings this many seconds after the button is pressed. */
export const TEST_ALARM_DELAY_SECONDS = 30;

/** Reminders made by the "test alarm" button start with this, so they are never real doses. */
export const TEST_REMINDER_PREFIX = 'test-';

export function isTestReminder(reminderId: string): boolean {
  return reminderId.startsWith(TEST_REMINDER_PREFIX);
}
