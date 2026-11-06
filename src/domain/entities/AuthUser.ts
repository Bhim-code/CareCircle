import type { AccountRole, Role } from './Role';

/** The signed-in person, as the rest of the app sees them. */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  /** "pending" until a supervisor approves the account. */
  readonly role: AccountRole;
  /**
   * What the backend lets this person do, such as "tasks.view" (from GET /me). Missing when the
   * backend did not say, which counts as nothing being allowed.
   */
  readonly permissions?: readonly string[];
}

/** A person whose account has a role, so they may use the app. */
export type ApprovedUser = AuthUser & { readonly role: Role };

export function isApproved(user: AuthUser): user is ApprovedUser {
  return user.role !== 'pending';
}
