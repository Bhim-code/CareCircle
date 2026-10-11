import type { IRolePolicy } from '../domain/policies/IRolePolicy';

/** Which parts of the Profile screen this person may see. */
export interface ProfileSections {
  /** Contact details of the caregivers a patient has added. */
  readonly caregiverContacts: boolean;
  /** Notification for a medicine that is due. */
  readonly reminderNotifications: boolean;
  /** Email and phone alerts when a patient misses a dose. */
  readonly missedDoseAlerts: boolean;
}

/**
 * Decides the sections from permissions, never from role names, so a new
 * role needs no change here. Name and email are shown to everyone and are
 * always the signed-in person's own.
 */
export function profileSectionsFor(policy: IRolePolicy): ProfileSections {
  return {
    caregiverContacts: policy.can('caregivers.manage'),
    reminderNotifications: policy.can('reminders.acknowledge'),
    missedDoseAlerts: policy.can('alerts.receive'),
  };
}
