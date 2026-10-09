import type { Role } from '../../domain/entities/Role';
import type { IRolePolicy, Permission } from '../../domain/policies/IRolePolicy';

/**
 * Shared behaviour for every role. Each role only declares what is different:
 * its name and the permissions it holds.
 */
export abstract class RolePolicy implements IRolePolicy {
  abstract readonly role: Role;
  abstract readonly displayName: string;
  protected abstract readonly permissions: ReadonlySet<Permission>;

  can(permission: Permission): boolean {
    return this.permissions.has(permission);
  }
}
