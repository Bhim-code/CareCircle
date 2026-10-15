import type { Role } from '../entities/Role';

export type Permission =
  | 'reminders.manage'
  | 'reminders.acknowledge'
  | 'caregivers.manage'
  | 'alerts.receive'
  | 'patients.monitor'
  | 'records.view'
  | 'entries.view'
  | 'entries.medical'
  | 'entries.behavioural'
  | 'entries.incident'
  | 'entries.medication';

/** What a role is allowed to do. The UI asks this; it never checks role names. */
export interface IRolePolicy {
  readonly role: Role;
  readonly displayName: string;
  can(permission: Permission): boolean;
}
