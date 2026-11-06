import type { CareLink, LinkedPerson } from '../../domain/entities/CareLink';
import type { ICareLinkService } from '../../domain/services/ICareLinkService';
import { DEMO_CAREGIVER_ID, DEMO_PATIENT_ID } from './demoIds';

const ANA: LinkedPerson = { id: DEMO_PATIENT_ID, name: 'Ana Patient', email: 'patient@demo.test' };
const SAM: LinkedPerson = { id: DEMO_CAREGIVER_ID, name: 'Sam Caregiver', email: 'caregiver@demo.test' };
const BEN: LinkedPerson = { id: 'demo-ben@demo.test', name: 'Ben Patient', email: 'ben@demo.test' };

/** An error with a status and code, like the API client's, so screens treat the demo and the real thing alike. */
class DemoLinkError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DemoLinkError';
  }
}

/**
 * Made-up care links kept in memory, for running the app with no server. Ana is looked after by
 * Sam, and Ben has invited Sam, so the demo caregiver has an invitation to accept. Lost on reload.
 */
export class DemoCareLinkService implements ICareLinkService {
  private links: CareLink[];
  private nextId = 100;

  constructor(
    private readonly latencyMs = 300,
    private readonly clock: () => Date = () => new Date(),
  ) {
    const now = clock().toISOString();
    this.links = [
      { id: 'l1', status: 'active', invitedEmail: SAM.email, patient: ANA, caregiver: SAM, createdAt: now, acceptedAt: now },
      { id: 'l2', status: 'pending', invitedEmail: SAM.email, patient: BEN, caregiver: null, createdAt: now, acceptedAt: null },
    ];
  }

  private pause(): Promise<void> {
    return this.latencyMs > 0 ? new Promise((resolve) => setTimeout(resolve, this.latencyMs)) : Promise.resolve();
  }

  /** The demo knows only its two accounts' emails. Anyone else sees their own links by id only. */
  private emailOf(userId: string): string | null {
    if (userId === DEMO_CAREGIVER_ID) return SAM.email;
    if (userId === DEMO_PATIENT_ID) return ANA.email;
    return null;
  }

  private visibleTo(userId: string, link: CareLink): boolean {
    if (link.patient.id === userId || link.caregiver?.id === userId) return true;
    return userId === DEMO_CAREGIVER_ID && link.status === 'pending' && link.invitedEmail === this.emailOf(userId);
  }

  async list(userId: string): Promise<readonly CareLink[]> {
    await this.pause();
    return this.links.filter((link) => link.status !== 'ended' && this.visibleTo(userId, link));
  }

  async invite(userId: string, email: string): Promise<CareLink> {
    await this.pause();
    if (userId !== DEMO_PATIENT_ID) throw new DemoLinkError(403, 'forbidden', 'Your account is not allowed to do this.');
    const wanted = email.trim().toLowerCase();
    if (wanted === ANA.email) throw new DemoLinkError(422, 'invalid', 'You cannot invite yourself.');
    const exists = this.links.some((link) => link.status !== 'ended' && link.patient.id === userId && link.invitedEmail.toLowerCase() === wanted);
    if (exists) throw new DemoLinkError(409, 'already_linked', 'This person is already invited or linked.');
    const link: CareLink = {
      id: `l${this.nextId++}`,
      status: 'pending',
      invitedEmail: wanted,
      patient: ANA,
      caregiver: null,
      createdAt: this.clock().toISOString(),
      acceptedAt: null,
    };
    this.links = [link, ...this.links];
    return link;
  }

  async accept(userId: string, linkId: string): Promise<CareLink> {
    await this.pause();
    const link = this.links.find((item) => item.id === linkId && item.status === 'pending');
    if (userId !== DEMO_CAREGIVER_ID || !link || link.invitedEmail !== SAM.email) {
      throw new DemoLinkError(404, 'not_found', 'Not found.');
    }
    const accepted: CareLink = { ...link, status: 'active', caregiver: SAM, acceptedAt: this.clock().toISOString() };
    this.links = this.links.map((item) => (item.id === linkId ? accepted : item));
    return accepted;
  }

  async remove(userId: string, linkId: string): Promise<void> {
    await this.pause();
    const link = this.links.find((item) => item.id === linkId && item.status !== 'ended');
    if (!link || !this.visibleTo(userId, link)) throw new DemoLinkError(404, 'not_found', 'Not found.');
    this.links = this.links.map((item) => (item.id === linkId ? { ...item, status: 'ended' as const } : item));
  }
}
