import type { CareLink, CareLinkStatus, LinkedPerson } from '../../domain/entities/CareLink';
import type { ICareLinkService } from '../../domain/services/ICareLinkService';
import { ApiClient } from './ApiClient';
import { ApiError } from './ApiError';

function badAnswer(): ApiError {
  return new ApiError(200, 'bad_response', 'The server sent something the app could not read.');
}

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw badAnswer();
  return value;
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function person(value: unknown): LinkedPerson {
  if (!isRow(value)) throw badAnswer();
  return { id: text(value.id), name: text(value.name), email: text(value.email) };
}

const STATUSES: readonly CareLinkStatus[] = ['pending', 'active', 'ended'];

/** Reads one link as the backend sends it (CareLinkOut in backend/app/schemas/care_links.py). */
export function toCareLink(value: unknown): CareLink {
  if (!isRow(value)) throw badAnswer();
  const status = value.status;
  if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) throw badAnswer();
  return {
    id: text(value.id),
    status: status as CareLinkStatus,
    invitedEmail: text(value.invitedEmail),
    patient: person(value.patient),
    caregiver: value.caregiver === null || value.caregiver === undefined ? null : person(value.caregiver),
    createdAt: text(value.createdAt),
    acceptedAt: textOrNull(value.acceptedAt),
  };
}

/** Care links against the CareCircle backend (backend/app/api/routes/care_links.py). */
export class HttpCareLinkService implements ICareLinkService {
  constructor(private readonly api: ApiClient) {}

  async list(_userId: string): Promise<readonly CareLink[]> {
    const answer = await this.api.get<unknown>('/care-links');
    if (!Array.isArray(answer)) throw badAnswer();
    return answer.map(toCareLink);
  }

  async invite(_userId: string, email: string): Promise<CareLink> {
    return toCareLink(await this.api.post<unknown>('/care-links/invitations', { email: email.trim() }));
  }

  async accept(_userId: string, linkId: string): Promise<CareLink> {
    return toCareLink(await this.api.post<unknown>(`/care-links/invitations/${encodeURIComponent(linkId)}/accept`));
  }

  async remove(_userId: string, linkId: string): Promise<void> {
    await this.api.delete<void>(`/care-links/${encodeURIComponent(linkId)}`);
  }
}
