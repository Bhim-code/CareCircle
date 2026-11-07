import type { CareLink } from '../entities/CareLink';

/**
 * Who looks after whom. A patient invites a caregiver by email; the caregiver accepts.
 * Every method rejects with an error that has a `code`, so screens can show a plain
 * sentence (see describeCareLinkError).
 */
export interface ICareLinkService {
  /** The person's links that are not over: active ones and pending invitations. */
  list(userId: string): Promise<readonly CareLink[]>;
  /** A patient invites someone by email. */
  invite(userId: string, email: string): Promise<CareLink>;
  /** A caregiver accepts an invitation sent to their email. */
  accept(userId: string, linkId: string): Promise<CareLink>;
  /** Either side ends a link, cancels an invitation they sent, or declines one they got. */
  remove(userId: string, linkId: string): Promise<void>;
}
