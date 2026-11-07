import type { AuthUser } from '../domain/entities/AuthUser';
import type { IAuthService } from '../domain/services/IAuthService';
import { describeAuthError } from './describeAuthError';

/**
 * What the backend lets a person do. The list comes from GET /me after sign-in, so a supervisor
 * can change it in the admin panel without a new app. These are the codes the app asks about.
 * (What only a kind of account has, such as reminders for a patient, is not a permission here.)
 */
export const TASKS_VIEW = 'tasks.view';
export const TASKS_COMPLETE = 'tasks.complete';
export const DOCUMENTS_VIEW = 'documents.view';
export const DOCUMENTS_UPLOAD = 'documents.upload';

/** Whether the person may do something. A missing list means nothing is allowed. */
export function hasPermission(permissions: readonly string[] | undefined, permission: string): boolean {
  return permissions?.includes(permission) ?? false;
}

/** True when two lists hold the same permissions, in any order. A missing list counts as empty. */
export function samePermissions(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const first = new Set(a ?? []);
  const second = new Set(b ?? []);
  if (first.size !== second.size) return false;
  for (const permission of first) if (!second.has(permission)) return false;
  return true;
}

/** What looking at the account again found out. */
export type SessionCheck =
  /** Nothing the app shows has changed. */
  | { readonly kind: 'same' }
  /** The role or the permissions changed. Show the person this new version of themselves. */
  | { readonly kind: 'changed'; readonly user: AuthUser }
  /** The sign-in ended, which is what the backend does when a supervisor changes a role. */
  | { readonly kind: 'signedOut' }
  /** The phone could not reach the server. Nothing is known, so nothing changes. */
  | { readonly kind: 'offline'; readonly message: string };

/**
 * Asks the backend who this is now and compares with who the app thinks it is. Never throws:
 * a background check must not crash the app, and a missing connection must not take
 * permissions away.
 */
export async function checkSession(service: IAuthService, current: AuthUser): Promise<SessionCheck> {
  try {
    const latest = await service.getCurrentUser();
    if (latest === null) return { kind: 'signedOut' };
    // A backend that did not send permissions this time says nothing new, so keep what is known.
    if (latest.permissions === undefined && current.permissions !== undefined) {
      return latest.role === current.role && latest.name === current.name ? { kind: 'same' } : { kind: 'changed', user: { ...latest, permissions: current.permissions } };
    }
    const unchanged =
      latest.id === current.id &&
      latest.role === current.role &&
      latest.name === current.name &&
      samePermissions(latest.permissions, current.permissions);
    return unchanged ? { kind: 'same' } : { kind: 'changed', user: latest };
  } catch (error) {
    return { kind: 'offline', message: describeAuthError(error) };
  }
}

/** How often the app looks again at what the signed-in person may do, in milliseconds. */
export const SESSION_CHECK_INTERVAL_MS = 5 * 60_000;
/** After the app comes back to the front, it does not look again if it looked less than this long ago. */
export const SESSION_CHECK_MIN_GAP_MS = 30_000;
