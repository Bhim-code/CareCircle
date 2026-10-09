import type { Role } from './Role';

/** The signed-in person, as the rest of the app sees them. */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
}
