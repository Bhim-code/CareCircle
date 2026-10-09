import type { Permission } from '../../domain/policies/IRolePolicy';
import { RolePolicy } from './RolePolicy';

export class PatientPolicy extends RolePolicy {
  readonly role = 'patient' as const;
  readonly displayName = 'Patient';
  protected readonly permissions: ReadonlySet<Permission> = new Set<Permission>([
    'reminders.manage',
    'reminders.acknowledge',
    'caregivers.manage',
  ]);
}
