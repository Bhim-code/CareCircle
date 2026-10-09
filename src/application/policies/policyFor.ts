import type { Role } from '../../domain/entities/Role';
import type { IRolePolicy } from '../../domain/policies/IRolePolicy';
import { CaregiverPolicy } from './CaregiverPolicy';
import { PatientPolicy } from './PatientPolicy';

const registry: Record<Role, IRolePolicy> = {
  patient: new PatientPolicy(),
  caregiver: new CaregiverPolicy(),
};

/** Adding a role means adding one class and one line here. */
export function policyFor(role: Role): IRolePolicy {
  return registry[role];
}
