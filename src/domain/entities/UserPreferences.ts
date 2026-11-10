/**
 * Settings a person controls for themselves. These are kept per account.
 * Nothing here is health information.
 */
export interface UserPreferences {
  /** Makes text in the app larger. Works on top of the phone's own text size. */
  readonly largerText: boolean;
  /** Patients: a notification on this device when a medicine is due. */
  readonly reminderNotifications: boolean;
  /** Patients: the alarm plays a sound. */
  readonly alarmSound: boolean;
  /** Patients: the alarm vibrates the phone (Android; iPhone follows its own settings). */
  readonly alarmVibration: boolean;
  /** Patients: how long Snooze waits, in minutes. One of SNOOZE_CHOICES. */
  readonly snoozeMinutes: number;
  /** Caregivers: be emailed when a patient has not confirmed a dose. */
  readonly missedDoseEmail: boolean;
  /** Caregivers: be phoned when a patient has not confirmed a dose. */
  readonly missedDoseCall: boolean;
}

/**
 * The settings the server keeps for the person, so they follow the person to a new phone.
 * The four switches are always there. The three alarm settings are optional here, because a
 * server that does not know them yet leaves them out, and then the phone keeps its own.
 */
export type SyncedPreferences = Pick<
  UserPreferences,
  'largerText' | 'reminderNotifications' | 'missedDoseEmail' | 'missedDoseCall'
> &
  Partial<Pick<UserPreferences, 'alarmSound' | 'alarmVibration' | 'snoozeMinutes'>>;

export const SYNCED_FIELDS = [
  'largerText',
  'reminderNotifications',
  'missedDoseEmail',
  'missedDoseCall',
  'alarmSound',
  'alarmVibration',
  'snoozeMinutes',
] as const;

/** The snooze lengths a person can pick from. */
export const SNOOZE_CHOICES = [5, 10, 15] as const;

export const DEFAULT_PREFERENCES: UserPreferences = {
  largerText: false,
  reminderNotifications: true,
  alarmSound: true,
  alarmVibration: true,
  snoozeMinutes: 10,
  missedDoseEmail: true,
  missedDoseCall: false,
};
