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
