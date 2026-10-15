import {
  ENTRY_KINDS,
  INCIDENT_SEVERITIES,
  MOODS,
  type EntryKind,
  type IncidentSeverity,
  type Mood,
  type RecordEntry,
  type RecordEntryInput,
} from '../domain/entities/RecordEntry';
import type { AuthUser } from '../domain/entities/AuthUser';
import type { IRolePolicy, Permission } from '../domain/policies/IRolePolicy';
import { dayKey } from './reminders';

export const KIND_LABEL: Record<EntryKind, string> = {
  medical: 'Medical record',
  behavioural: 'Behavioural record',
  incident: 'Incident record',
  medication: 'Medication record',
};

/** One line that says what each kind is for, shown on the "Add a record" buttons. */
export const KIND_HELP: Record<EntryKind, string> = {
  medical: 'A symptom, visit, test result or health change.',
  behavioural: 'How the patient seemed: mood, sleep, appetite, confusion.',
  incident: 'Something that went wrong, such as a fall or a reaction.',
  medication: 'Note a medicine, and take a photo of the bottle or label.',
};

export const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  minor: 'Minor',
  moderate: 'Moderate',
  serious: 'Serious',
};

export const MOOD_LABEL: Record<Mood, string> = {
  calm: 'Calm',
  happy: 'Happy',
  anxious: 'Anxious',
  confused: 'Confused',
  agitated: 'Agitated',
  withdrawn: 'Withdrawn',
};

const PERMISSION_FOR_KIND: Record<EntryKind, Permission> = {
  medical: 'entries.medical',
  behavioural: 'entries.behavioural',
  incident: 'entries.incident',
  medication: 'entries.medication',
};

export function permissionFor(kind: EntryKind): Permission {
  return PERMISSION_FOR_KIND[kind];
}

/** The kinds this role may write, in a fixed order. */
export function addableKinds(policy: IRolePolicy): EntryKind[] {
  return ENTRY_KINDS.filter((kind) => policy.can(PERMISSION_FOR_KIND[kind]));
}

/** Only the person who wrote an entry can edit it, and only for a kind their role may write. */
export function canEditEntry(policy: IRolePolicy, user: AuthUser, entry: RecordEntry): boolean {
  return entry.recordedBy.id === user.id && policy.can(PERMISSION_FOR_KIND[entry.kind]);
}

// ---------------------------------------------------------------- dates

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clock(date: Date): string {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** "Oct 15, 2026 at 2:30 PM" */
export function formatStamp(iso: string): string {
  const date = new Date(iso);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} at ${clock(date)}`;
}

/** "14:30" in 24-hour form, used to fill the time box. */
export function timeKey(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Reads "2026-10-15". Returns null for anything that is not a real calendar date. */
export function parseDateText(text: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(year, month - 1, day);
  const real = check.getFullYear() === year && check.getMonth() === month - 1 && check.getDate() === day;
  return real ? { year, month, day } : null;
}

/** Reads "14:30", "2:30 PM", "2:30pm". Returns null when it is not a real time. */
export function parseTimeText(text: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(text.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const suffix = match[3]?.toLowerCase();
  if (minutes > 59) return null;
  if (suffix) {
    if (hours < 1 || hours > 12) return null;
    if (suffix === 'pm' && hours !== 12) hours += 12;
    if (suffix === 'am' && hours === 12) hours = 0;
  } else if (hours > 23) {
    return null;
  }
  return { hours, minutes };
}

// ---------------------------------------------------------------- the form

/** Everything on the form as the person typed it. Text boxes hold strings, never null. */
export interface EntryDraft {
  clientName: string;
  title: string;
  notes: string;
  date: string;
  time: string;
  witnessName: string;
  location: string;
  severity: IncidentSeverity | null;
  actionTaken: string;
  mood: Mood | null;
  medicineName: string;
  photoUri: string | null;
}

export type DraftField = keyof EntryDraft;
export type DraftErrors = Partial<Record<DraftField, string>>;

/** A fresh form. A patient is the client, so their name is filled in. Date and time default to now. */
export function blankDraft(user: AuthUser, now: Date): EntryDraft {
  return {
    clientName: user.role === 'patient' ? user.name : '',
    title: '',
    notes: '',
    date: dayKey(now),
    time: timeKey(now),
    witnessName: '',
    location: '',
    severity: null,
    actionTaken: '',
    mood: null,
    medicineName: '',
    photoUri: null,
  };
}

/** Fills the form from a saved entry, for editing. */
export function draftFromEntry(entry: RecordEntry): EntryDraft {
  const when = new Date(entry.occurredAt);
  return {
    clientName: entry.clientName,
    title: entry.kind === 'medical' ? entry.title : '',
    notes: entry.notes,
    date: dayKey(when),
    time: timeKey(when),
    witnessName: entry.witnessName ?? '',
    location: entry.location ?? '',
    severity: entry.severity,
    actionTaken: entry.actionTaken ?? '',
    mood: entry.mood,
    medicineName: entry.medicineName ?? '',
    photoUri: entry.photoUri,
  };
}

/** Which boxes each kind of form shows. The screen and the checks both use this. */
export const FIELDS_FOR_KIND: Record<EntryKind, readonly DraftField[]> = {
  medical: ['clientName', 'title', 'notes', 'date', 'time'],
  behavioural: ['clientName', 'mood', 'notes', 'date', 'time'],
  incident: ['clientName', 'date', 'time', 'location', 'severity', 'notes', 'actionTaken', 'witnessName'],
  medication: ['clientName', 'medicineName', 'photoUri', 'notes', 'date', 'time'],
};

const MAX_SHORT = 100;
const MAX_LONG = 2000;

function optional(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

/** What shows on the list card for entries that have no title box of their own. */
function titleFor(kind: EntryKind, draft: EntryDraft): string {
  switch (kind) {
    case 'medical':
      return draft.title.trim();
    case 'behavioural':
      return draft.mood ? `Mood: ${MOOD_LABEL[draft.mood]}` : 'Behaviour';
    case 'incident':
      return draft.location.trim() ? `Incident: ${draft.location.trim()}` : 'Incident';
    case 'medication':
      return draft.medicineName.trim();
  }
}

export type DraftResult =
  | { readonly ok: true; readonly input: RecordEntryInput }
  | { readonly ok: false; readonly errors: DraftErrors };

/** Checks the form. On success returns the entry ready to save; otherwise one message per bad box. */
export function validateDraft(kind: EntryKind, draft: EntryDraft, now: Date): DraftResult {
  const errors: DraftErrors = {};
  const shown = FIELDS_FOR_KIND[kind];

  if (draft.clientName.trim() === '') errors.clientName = 'Please enter the client’s name.';

  if (kind === 'medical' && draft.title.trim() === '') errors.title = 'Please say what this is about.';
  if (kind === 'behavioural' && !draft.mood) errors.mood = 'Please choose how they seemed.';
  if (kind === 'incident') {
    if (!draft.severity) errors.severity = 'Please choose how serious it was.';
    if (draft.notes.trim() === '') errors.notes = 'Please describe what happened.';
  }
  if (kind === 'medication' && draft.medicineName.trim() === '') {
    errors.medicineName = 'Please enter the medicine’s name.';
  }

  // Length limits keep one entry from holding a whole book.
  for (const field of ['clientName', 'title', 'witnessName', 'location', 'medicineName'] as const) {
    if (shown.includes(field) && draft[field].length > MAX_SHORT) errors[field] = `Please keep this under ${MAX_SHORT} characters.`;
  }
  for (const field of ['notes', 'actionTaken'] as const) {
    if (shown.includes(field) && draft[field].length > MAX_LONG) errors[field] = `Please keep this under ${MAX_LONG} characters.`;
  }

  // Date and time become one moment, which cannot be in the future.
  const date = parseDateText(draft.date);
  const time = parseTimeText(draft.time);
  if (!date) errors.date = 'Use the form 2026-10-15.';
  if (!time) errors.time = 'Use the form 14:30 or 2:30 PM.';
  let occurredAt = '';
  if (date && time) {
    const moment = new Date(date.year, date.month - 1, date.day, time.hours, time.minutes);
    if (moment.getTime() > now.getTime() + 60 * 1000) errors.date = 'That time has not happened yet.';
    else occurredAt = moment.toISOString();
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const is = (wanted: EntryKind) => kind === wanted;
  return {
    ok: true,
    input: {
      kind,
      clientName: draft.clientName.trim(),
      title: titleFor(kind, draft),
      notes: draft.notes.trim(),
      occurredAt,
      witnessName: is('incident') ? optional(draft.witnessName) : null,
      location: is('incident') ? optional(draft.location) : null,
      severity: is('incident') ? draft.severity : null,
      actionTaken: is('incident') ? optional(draft.actionTaken) : null,
      mood: is('behavioural') ? draft.mood : null,
      medicineName: is('medication') ? draft.medicineName.trim() : null,
      photoUri: is('medication') ? draft.photoUri : null,
    },
  };
}

// ---------------------------------------------------------------- the list

/** A kind to filter by, or every kind. */
export type EntryFilter = EntryKind | 'all';
export const ENTRY_FILTERS: readonly EntryFilter[] = ['all', ...ENTRY_KINDS];

export function entryFilterLabel(filter: EntryFilter): string {
  return filter === 'all' ? 'All' : KIND_LABEL[filter].replace(' record', '');
}

/** Newest first, by when it happened. Ties go to whichever was written last. */
export function sortEntries(entries: readonly RecordEntry[]): RecordEntry[] {
  return [...entries].sort(
    (a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.recordedAt.localeCompare(a.recordedAt),
  );
}

export function filterEntries(entries: readonly RecordEntry[], filter: EntryFilter): RecordEntry[] {
  return filter === 'all' ? [...entries] : entries.filter((entry) => entry.kind === filter);
}

export function countEntries(entries: readonly RecordEntry[]): Record<EntryFilter, number> {
  const counts = { all: entries.length } as Record<EntryFilter, number>;
  for (const kind of ENTRY_KINDS) counts[kind] = 0;
  for (const entry of entries) counts[entry.kind] += 1;
  return counts;
}

/** "Edited Oct 15, 2026 at 2:40 PM by Sam Caregiver", or null if it was never edited. */
export function editedNote(entry: RecordEntry): string | null {
  if (!entry.editedAt) return null;
  const by = entry.editedBy ? ` by ${entry.editedBy.name}` : '';
  return `Edited ${formatStamp(entry.editedAt)}${by}`;
}

export function entryEmptyMessage(filter: EntryFilter, total: number): string {
  if (total === 0) return 'No records yet. Use the buttons above to add the first one.';
  return `No ${entryFilterLabel(filter).toLowerCase()} records yet.`;
}

export { INCIDENT_SEVERITIES, MOODS };
