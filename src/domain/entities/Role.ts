/** The two kinds of account in CareCircle. */
export const ROLES = ['patient', 'caregiver'] as const;

export type Role = (typeof ROLES)[number];

/**
 * What the backend says an account is. A new account is "pending" until a supervisor
 * gives it a role, and a pending account may not use the app yet.
 */
export type AccountRole = Role | 'pending';

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
