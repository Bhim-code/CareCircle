import type { CareLink } from '../domain/entities/CareLink';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An error message for the invitation box, or undefined when the email is fine. */
export function validateInviteEmail(value: string, ownEmail: string): string | undefined {
  const email = value.trim();
  if (!email) return 'Enter the email address of the person you want to invite.';
  if (!EMAIL_PATTERN.test(email)) return 'Enter an email address like name@example.com.';
  if (email.toLowerCase() === ownEmail.trim().toLowerCase()) return 'That is your own email. Invite someone else.';
  return undefined;
}

/** What is shown on the screen, split the way a person thinks about it. */
export interface CareLinkGroups {
  readonly active: readonly CareLink[];
  readonly pending: readonly CareLink[];
}

/** Active links first, then pending ones; each list is in a steady order (by name, then email). */
export function groupLinks(links: readonly CareLink[]): CareLinkGroups {
  const label = (link: CareLink) => (link.caregiver?.name ?? link.invitedEmail).toLowerCase();
  const byLabel = (a: CareLink, b: CareLink) => label(a).localeCompare(label(b));
  return {
    active: links.filter((link) => link.status === 'active').sort(byLabel),
    pending: links.filter((link) => link.status === 'pending').sort(byLabel),
  };
}

/** The other person in a link, as seen by this viewer: the caregiver for a patient, the patient for a caregiver. */
export function otherPerson(link: CareLink, viewerId: string): { name: string; email: string } {
  if (link.patient.id === viewerId) {
    return link.caregiver ? { name: link.caregiver.name, email: link.caregiver.email } : { name: link.invitedEmail, email: link.invitedEmail };
  }
  return { name: link.patient.name, email: link.patient.email };
}

/** A sentence for a failed invitation, accept or remove. It reads only `status`, `code`, `message` and `fields`. */
export function describeCareLinkError(error: unknown): string {
  const read = (key: string): unknown =>
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>)[key] : undefined;
  const code = typeof read('code') === 'string' ? (read('code') as string) : '';
  const status = typeof read('status') === 'number' ? (read('status') as number) : 0;
  const message = typeof read('message') === 'string' ? (read('message') as string) : '';
  const fields = read('fields');
  const firstField =
    typeof fields === 'object' && fields !== null
      ? Object.values(fields as Record<string, unknown>).find((value): value is string => typeof value === 'string') ?? ''
      : '';

  if (code === 'network' || code === 'timeout') return 'Cannot reach the server. Check your connection and try again.';
  if (code === 'session_expired' || code === 'unauthenticated') return 'Your sign-in has ended. Please sign in again.';
  if (code === 'too_many_requests') return 'Too many tries for now. Please wait a little and try again.';
  if (code === 'already_linked' || status === 409) return 'This person is already invited or linked to you.';
  if (status === 403) return 'Your account is not allowed to do this.';
  if (status === 404) return 'This invitation or link is no longer there. Refresh the list.';
  if (status === 422 && (firstField || message)) return firstField || message;
  return 'We could not do that. Please try again.';
}
