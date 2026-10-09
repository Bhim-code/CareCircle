import type { AuthUser } from '../../domain/entities/AuthUser';
import { isRole } from '../../domain/entities/Role';
import { AuthError } from '../../domain/errors/AuthError';

/** A row from the `profiles` table. */
export interface ProfileRow {
  id: string;
  name: string | null;
  role: string | null;
}

/**
 * Builds an AuthUser from a profile row. The role always comes from the
 * database and is never guessed, so a missing or unknown role is an error
 * rather than a silent default.
 */
export function toAuthUser(row: ProfileRow, email: string): AuthUser {
  if (!isRole(row.role)) throw new AuthError('profile_unavailable');
  return { id: row.id, email, name: row.name ?? '', role: row.role };
}
