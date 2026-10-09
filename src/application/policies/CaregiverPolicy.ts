import type { Permission } from '../../domain/policies/IRolePolicy';
import { RolePolicy } from './RolePolicy';

export class CaregiverPolicy extends RolePolicy {
  readonly role = 'caregiver' as const;
  readonly displayName = 'Caregiver';
  protected readonly permissions: ReadonlySet<Permission> = new Set<Permission>([
    'alerts.receive',
    'patients.monitor',
  ]);
}
