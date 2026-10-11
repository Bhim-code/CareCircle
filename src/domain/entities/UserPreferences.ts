/**
 * Settings a person controls for themselves. These are kept per account.
 * Nothing here is health information.
 */
export interface UserPreferences {
  /** Makes text in the app larger. Works on top of the phone's own text size. */
  readonly largerText: boolean;
  /** Patients: a notification on this device when a medicine is due. */
  readonly reminderNotifications: boolean;
  /** Caregivers: be emailed when a patient has not confirmed a dose. */
  readonly missedDoseEmail: boolean;
  /** Caregivers: be phoned when a patient has not confirmed a dose. */
  readonly missedDoseCall: boolean;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  largerText: false,
  reminderNotifications: true,
  missedDoseEmail: true,
  missedDoseCall: false,
};
