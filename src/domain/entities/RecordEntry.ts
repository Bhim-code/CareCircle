import type { Role } from './Role';

/**
 * The kinds of entry a person can write. Not the same as the scanned
 * documents (prescriptions, lab reports) which are listed separately.
 */
export const ENTRY_KINDS = ['medical', 'behavioural', 'incident', 'medication'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const INCIDENT_SEVERITIES = ['minor', 'moderate', 'serious'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const MOODS = ['calm', 'happy', 'anxious', 'confused', 'agitated', 'withdrawn'] as const;
export type Mood = (typeof MOODS)[number];

/** Who is writing or editing an entry. */
export interface EntryAuthor {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
}

/**
 * What a person fills in. Fields that do not apply to a kind stay null
 * (for example `witnessName` on a medical entry).
 */
export interface RecordEntryInput {
  readonly kind: EntryKind;
  /** The person being cared for ("client"). */
  readonly clientName: string;
  /** A short heading. Built from the other fields when the kind has no title box. */
  readonly title: string;
  /** Free-text details: what happened, what was observed, and so on. */
  readonly notes: string;
  /** When the thing happened or was observed, ISO date-time. */
  readonly occurredAt: string;
  // Incident only
  readonly witnessName: string | null;
  readonly location: string | null;
  readonly severity: IncidentSeverity | null;
  readonly actionTaken: string | null;
  // Behavioural only
  readonly mood: Mood | null;
  // Medication only
  readonly medicineName: string | null;
  /** Where the photo is stored. A local file for now. */
  readonly photoUri: string | null;
}

/** A saved entry, with who wrote it and when. */
export interface RecordEntry extends RecordEntryInput {
  readonly id: string;
  /** Set by the system when first saved. Never edited. */
  readonly recordedAt: string;
  readonly recordedBy: EntryAuthor;
  /** Null until the entry is edited. Shown as "Edited". */
  readonly editedAt: string | null;
  readonly editedBy: EntryAuthor | null;
}
