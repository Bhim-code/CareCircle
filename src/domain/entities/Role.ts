/** The two kinds of account in CareCircle. */
export const ROLES = ['patient', 'caregiver'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
