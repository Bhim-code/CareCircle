import type { Reminder } from '../domain/entities/Reminder';

/** How the alarm for one dose behaves. */
export interface AlarmSettings {
  /** How long the alarm rings before it gives up, in minutes. */
  readonly ringMinutes: number;
  /** How long "Snooze" waits before ringing again. */
  readonly snoozeMinutes: number;
}

/** One alarm per dose, ringing for 2 minutes. Snooze is 10 minutes. */
export const DEFAULT_ALARM: AlarmSettings = {
  ringMinutes: 2,
  snoozeMinutes: 10,
};

/** One alarm the phone should show at one moment. */
export interface PlannedRing {
  /** Same id every time for the same alarm, so scheduling again replaces it and never doubles it. */
  readonly id: string;
  readonly reminderId: string;
  readonly medicineName: string;
  readonly fireAt: Date;
  /** How long it keeps ringing if nobody answers. */
  readonly ringSeconds: number;
  /** True for the alarm that follows a Snooze press. */
  readonly snoozed: boolean;
}

const MINUTE = 60 * 1000;

/**
 * The phone allows only a limited number of waiting notifications (iOS keeps
 * 64), so only the next day and a half is planned, and never more than this.
 */
export const PLAN_HORIZON_HOURS = 36;
export const MAX_PLANNED_RINGS = 60;

export const RING_PREFIX = 'ring:';
export const SNOOZE_PREFIX = 'snooze:';

/** A few minutes after the alarm stops, to react, before the dose counts as missed. */
const GRACE_MINUTES = 3;

/** How long after the dose time a dose still counts as "due" before it is "missed". */
export function missedAfterMinutes(settings: AlarmSettings = DEFAULT_ALARM): number {
  return settings.ringMinutes + GRACE_MINUTES;
}

function ring(
  reminderId: string,
  medicineName: string,
  fireAt: Date,
  settings: AlarmSettings,
  snoozed: boolean,
): PlannedRing {
  return {
    id: `${snoozed ? SNOOZE_PREFIX : RING_PREFIX}${reminderId}`,
    reminderId,
    medicineName,
    fireAt,
    ringSeconds: settings.ringMinutes * 60,
    snoozed,
  };
}

/**
 * Every alarm that should be waiting on the phone right now, soonest first:
 * one per dose. Doses already taken or skipped get none, and times in the past
 * are dropped.
 */
export function planRings(
  reminders: readonly Reminder[],
  now: Date,
  settings: AlarmSettings = DEFAULT_ALARM,
): PlannedRing[] {
  const horizon = now.getTime() + PLAN_HORIZON_HOURS * 60 * MINUTE;
  return reminders
    .filter((reminder) => !reminder.acknowledged && !reminder.skipped)
    .map((reminder) =>
      ring(reminder.id, reminder.medicineName, new Date(reminder.scheduledAt), settings, false),
    )
    .filter((item) => item.fireAt.getTime() > now.getTime() && item.fireAt.getTime() <= horizon)
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
    .slice(0, MAX_PLANNED_RINGS);
}

/** The alarm after "Snooze": one alarm, the chosen number of minutes from now. */
export function planSnooze(
  reminderId: string,
  medicineName: string,
  now: Date,
  settings: AlarmSettings = DEFAULT_ALARM,
): PlannedRing {
  return ring(
    reminderId,
    medicineName,
    new Date(now.getTime() + settings.snoozeMinutes * MINUTE),
    settings,
    true,
  );
}

/** The words shown on an alarm. Plain and short, because it may be read on a locked screen. */
export function ringText(item: Pick<PlannedRing, 'medicineName' | 'snoozed'>): {
  title: string;
  body: string;
} {
  return {
    title: item.snoozed ? 'Reminder: time for your medicine' : 'Time for your medicine',
    body: `${item.medicineName}. Open to say you took it.`,
  };
}

/**
 * How many seconds of ringing are left for an alarm that was due at `fireAtMs`.
 * Zero if it has already finished, or has not started yet. Opening an old alarm
 * (for example from a missed notification) must stay silent.
 */
export function remainingRingSeconds(
  fireAtMs: number | null,
  nowMs: number,
  ringSeconds: number = DEFAULT_ALARM.ringMinutes * 60,
): number {
  if (fireAtMs === null) return 0;
  const sinceStart = (nowMs - fireAtMs) / 1000;
  if (sinceStart < -2) return 0; // not due yet
  return Math.max(0, Math.round(ringSeconds - Math.max(sinceStart, 0)));
}
