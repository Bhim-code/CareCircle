import type { Role } from '../entities/Role';

export type Permission =
  | 'reminders.manage'
  | 'reminders.acknowledge'
  | 'caregivers.manage'
  | 'alerts.receive'
  | 'patients.monitor'
  | 'entries.view';

/**
 * What a kind of account has by its nature: a patient has reminders, a caregiver looks after
 * patients. The UI asks this; it never checks role names. Everything the backend can switch on
 * or off per person (writing records, documents, care tasks) comes from the server's
 * permissions instead (see application/permissions.ts).
 */
export interface IRolePolicy {
  readonly role: Role;
  readonly displayName: string;
  can(permission: Permission): boolean;
}
