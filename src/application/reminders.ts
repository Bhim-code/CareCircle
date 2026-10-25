import type { Reminder, ReminderStatus } from '../domain/entities/Reminder';
import { missedAfterMinutes } from './alarmPlan';

/**
 * A reminder counts as "due" until the last alarm ring has gone unanswered
 * (the dose time, then 5 and 10 minutes later, plus a few minutes to react).
 * After that it is missed. It can still be confirmed later.
 */
export const DUE_WINDOW_MINUTES = missedAfterMinutes();

const MINUTE = 60 * 1000;

/** upcoming -> due -> missed, unless the person has acknowledged it. */
export function reminderStatus(reminder: Reminder, now: Date): ReminderStatus {
  if (reminder.acknowledged) return 'acknowledged';
  if (reminder.skipped) return 'skipped';
  const minutesLate = (now.getTime() - new Date(reminder.scheduledAt).getTime()) / MINUTE;
  if (minutesLate < 0) return 'upcoming';
  if (minutesLate <= DUE_WINDOW_MINUTES) return 'due';
  return 'missed';
}

export interface TodaySummary {
  readonly total: number;
  readonly acknowledged: number;
  readonly skipped: number;
  readonly missed: number;
  /** Still to come or due now. */
  readonly remaining: number;
  /** The next reminder that still needs attention, or null when there is none. */
  readonly next: { readonly reminder: Reminder; readonly status: ReminderStatus } | null;
}

/** Counts today's reminders and picks the next one. Expects reminders for one day only. */
export function summarizeToday(reminders: readonly Reminder[], now: Date): TodaySummary {
  const sorted = [...reminders].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const withStatus = sorted.map((reminder) => ({ reminder, status: reminderStatus(reminder, now) }));

  const open = withStatus.filter((item) => item.status === 'due' || item.status === 'upcoming');

  return {
    total: reminders.length,
    acknowledged: withStatus.filter((item) => item.status === 'acknowledged').length,
    skipped: withStatus.filter((item) => item.status === 'skipped').length,
    missed: withStatus.filter((item) => item.status === 'missed').length,
    remaining: open.length,
    next: open[0] ?? null,
  };
}

/** Today's date as YYYY-MM-DD in local time. */
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "Monday, October 12" */
export function formatDate(date: Date): string {
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** "8:00 AM" */
export function formatTime(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hours < 12 ? 'AM' : 'PM';
  return `${hours % 12 || 12}:${minutes} ${suffix}`;
}

export const STATUS_LABEL: Record<ReminderStatus, string> = {
  upcoming: 'Upcoming',
  due: 'Due now',
  acknowledged: 'Taken',
  skipped: 'Skipped',
  missed: 'Missed',
};

/** Only a reminder that is due or missed can be confirmed. Not one that is still to come. */
export function canAcknowledge(status: ReminderStatus): boolean {
  return status === 'due' || status === 'missed';
}

/** One plain sentence about where a reminder stands. */
export const STATUS_HELP: Record<ReminderStatus, string> = {
  upcoming: 'It is not time for this medicine yet.',
  due: 'It is time to take this medicine. Press the button once you have taken it.',
  acknowledged: 'You confirmed that you took this medicine.',
  skipped: 'You chose to skip this dose.',
  missed: 'This reminder was not confirmed. If you did take it, you can still tell us.',
};

/** Reminders in the order they happen during the day. */
export function sortByTime(reminders: readonly Reminder[]): Reminder[] {
  return [...reminders].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}
