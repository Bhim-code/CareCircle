import type { EntryAuthor, EntryKind, IncidentSeverity, Mood, RecordEntry, RecordEntryInput } from '../../domain/entities/RecordEntry';
import { ENTRY_KINDS, INCIDENT_SEVERITIES, MOODS } from '../../domain/entities/RecordEntry';
import type { Person } from '../../domain/entities/Person';
import { isRole, type Role } from '../../domain/entities/Role';
import type { IRecordEntryService } from '../../domain/services/IRecordEntryService';
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

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw badAnswer();
}

function person(value: unknown): EntryAuthor {
  if (!isRow(value)) throw badAnswer();
  // Only patients and caregivers write records. Anyone else is shown as a caregiver.
  const role: Role = isRole(value.role) ? value.role : 'caregiver';
  return { id: text(value.id), name: text(value.name), role };
}

/** Reads one entry as the backend sends it (EntryOut in backend/app/schemas/entries.py). */
export function toRecordEntry(value: unknown): RecordEntry {
  if (!isRow(value)) throw badAnswer();
  const kind = oneOf<EntryKind>(value.kind, ENTRY_KINDS);
  if (kind === null) throw badAnswer();
  const occurredAt = text(value.occurredAt);
  if (Number.isNaN(new Date(occurredAt).getTime())) throw badAnswer();
  return {
    id: text(value.id),
    patientId: text(value.patientId),
    kind,
    clientName: textOrNull(value.clientName) ?? '',
    title: text(value.title),
    notes: textOrNull(value.notes) ?? '',
    occurredAt,
    witnessName: textOrNull(value.witnessName),
    location: textOrNull(value.location),
    severity: oneOf<IncidentSeverity>(value.severity, INCIDENT_SEVERITIES),
    actionTaken: textOrNull(value.actionTaken),
    mood: oneOf<Mood>(value.mood, MOODS),
    medicineName: textOrNull(value.medicineName),
    photoUri: textOrNull(value.photoUri),
    recordedAt: text(value.recordedAt),
    recordedBy: person(value.recordedBy),
    editedAt: textOrNull(value.editedAt),
    editedBy: value.editedBy === null || value.editedBy === undefined ? null : person(value.editedBy),
  };
}

/** A link the server gave for a photo it already holds, as opposed to a file on the phone. */
export function isServerPhoto(uri: string): boolean {
  return uri.includes('/files/photos/');
}

/** Adds the photo to the upload form. On the phone it is an object with the file's address. */
export type AppendPhoto = (form: FormData, uri: string) => void;

const appendPhonePhoto: AppendPhoto = (form, uri) => {
  const ending = (uri.split('?')[0].split('.').pop() ?? '').toLowerCase();
  const type = ending === 'png' ? 'image/png' : 'image/jpeg';
  form.append('file', { uri, name: `photo.${ending === 'png' ? 'png' : 'jpg'}`, type } as unknown as Blob);
};

const UPLOAD_TIMEOUT_MS = 60_000;

/** Written records against the CareCircle backend (backend/app/api/routes/entries.py). */
export class HttpRecordEntryService implements IRecordEntryService {
  constructor(
    private readonly api: ApiClient,
    private readonly appendPhoto: AppendPhoto = appendPhonePhoto,
  ) {}

  async list(_viewerId: string): Promise<readonly RecordEntry[]> {
    const answer = await this.api.get<unknown>('/entries');
    if (!Array.isArray(answer)) throw badAnswer();
    // The server sends newest first. The screens sort again themselves.
    return answer.map((item) => this.withFullLink(toRecordEntry(item)));
  }

  async add(_author: EntryAuthor, input: RecordEntryInput): Promise<RecordEntry> {
    const body = await this.body(input);
    return this.withFullLink(toRecordEntry(await this.api.post<unknown>('/entries', body)));
  }

  async update(_author: EntryAuthor, entryId: string, input: RecordEntryInput): Promise<RecordEntry> {
    const body = await this.body(input);
    return this.withFullLink(toRecordEntry(await this.api.put<unknown>(`/entries/${encodeURIComponent(entryId)}`, body)));
  }

  /** The people with an active care link to this person. For a caregiver that is their clients. */
  async clients(_viewerId: string): Promise<readonly Person[]> {
    const answer = await this.api.get<unknown>('/care-links');
    if (!Array.isArray(answer)) throw badAnswer();
    const seen = new Map<string, Person>();
    for (const link of answer) {
      if (!isRow(link) || link.status !== 'active' || !isRow(link.patient)) continue;
      const id = text(link.patient.id);
      if (!seen.has(id)) seen.set(id, { id, name: text(link.patient.name) });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A photo taken on the phone is sent first. The record then holds the link the server gives back. */
  private async photoLink(uri: string | null): Promise<string | null> {
    if (uri === null) return null;
    if (isServerPhoto(uri)) return uri;
    const form = new FormData();
    this.appendPhoto(form, uri);
    const uploaded = await this.api.post<unknown>('/entries/photo', form, { timeoutMs: UPLOAD_TIMEOUT_MS });
    if (!isRow(uploaded)) throw badAnswer();
    return text(uploaded.photoUri);
  }

  private async body(input: RecordEntryInput): Promise<Record<string, unknown>> {
    return {
      kind: input.kind,
      clientName: input.clientName,
      title: input.title,
      notes: input.notes,
      // Always with a time zone ("...Z"), as the backend requires.
      occurredAt: new Date(input.occurredAt).toISOString(),
      witnessName: input.witnessName,
      location: input.location,
      severity: input.severity,
      actionTaken: input.actionTaken,
      mood: input.mood,
      medicineName: input.medicineName,
      photoUri: await this.photoLink(input.photoUri),
      ...(input.patientId ? { patientId: input.patientId } : {}),
    };
  }

  private withFullLink(entry: RecordEntry): RecordEntry {
    return entry.photoUri ? { ...entry, photoUri: this.api.absoluteUrl(entry.photoUri) } : entry;
  }
}
