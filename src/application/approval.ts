import type { AuthUser } from '../domain/entities/AuthUser';
import type { IAuthService } from '../domain/services/IAuthService';
import { describeAuthError } from './describeAuthError';

/** What a check of a waiting account found out. */
export type ApprovalCheck =
  /** Still waiting for a supervisor. */
  | { readonly kind: 'pending'; readonly user: AuthUser }
  /** The account has a role now. The app can open. */
  | { readonly kind: 'approved'; readonly user: AuthUser }
  /** The sign-in ended, which is what the backend does when a supervisor gives a role. */
  | { readonly kind: 'signedOut' }
  /** The phone could not reach the server, so nothing is known yet. */
  | { readonly kind: 'offline'; readonly message: string };

/** Asks the backend who this is now. Never throws: a waiting screen must not crash. */
export async function checkApproval(service: IAuthService): Promise<ApprovalCheck> {
  try {
    const user = await service.getCurrentUser();
    if (user === null) return { kind: 'signedOut' };
    return user.role === 'pending' ? { kind: 'pending', user } : { kind: 'approved', user };
  } catch (error) {
    return { kind: 'offline', message: describeAuthError(error) };
  }
}

/** What the sign-in screen says after the backend ended a waiting person's sign-in. */
export const ACCOUNT_UPDATED_NOTICE =
  'Your account was updated. Please sign in again to start using CareCircle.';

/** How often the waiting screen looks again, in milliseconds. */
export const APPROVAL_CHECK_INTERVAL_MS = 60_000;
