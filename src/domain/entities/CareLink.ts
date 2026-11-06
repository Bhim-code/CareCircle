/** A person in a care link, with the email the link is about. */
export interface LinkedPerson {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

/** pending: invited, not yet accepted. active: the caregiver can see the patient's records. ended: over. */
export type CareLinkStatus = 'pending' | 'active' | 'ended';

/**
 * A patient and a caregiver who look after the patient together. The caregiver is
 * unknown (null) until the invitation is accepted.
 */
export interface CareLink {
  readonly id: string;
  readonly status: CareLinkStatus;
  /** The email the patient invited. */
  readonly invitedEmail: string;
  readonly patient: LinkedPerson;
  readonly caregiver: LinkedPerson | null;
  readonly createdAt: string;
  readonly acceptedAt: string | null;
}
