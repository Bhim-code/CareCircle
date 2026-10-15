import type { EntryAuthor, RecordEntry, RecordEntryInput } from '../../domain/entities/RecordEntry';
import type { IRecordEntryService } from '../../domain/services/IRecordEntryService';
import { DEMO_CAREGIVER_ID, DEMO_PATIENT_ID } from './demoIds';

const PATIENT: EntryAuthor = { id: DEMO_PATIENT_ID, name: 'Ana Patient', role: 'patient' };
const CAREGIVER: EntryAuthor = { id: DEMO_CAREGIVER_ID, name: 'Sam Caregiver', role: 'caregiver' };

const BLANK = {
  witnessName: null,
  location: null,
  severity: null,
  actionTaken: null,
  mood: null,
  medicineName: null,
  photoUri: null,
  editedAt: null,
  editedBy: null,
} as const;

/** A moment `daysAgo` days before `now`, at the given hour and minute. */
function at(now: Date, daysAgo: number, hour: number, minute: number): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute).toISOString();
}

function seed(now: Date): RecordEntry[] {
  return [
    {
      ...BLANK,
      id: 'e1',
      kind: 'medical',
      clientName: 'Ana Patient',
      title: 'Dizzy when standing up',
      notes: 'Felt light-headed for a few minutes after getting out of bed. Sat down and it passed.',
      occurredAt: at(now, 3, 7, 40),
      recordedAt: at(now, 3, 8, 5),
      recordedBy: PATIENT,
    },
    {
      ...BLANK,
      id: 'e2',
      kind: 'behavioural',
      clientName: 'Ana Patient',
      title: 'Mood: Anxious',
      mood: 'anxious',
      notes: 'Restless in the evening and asked the same question several times. Settled after tea.',
      occurredAt: at(now, 2, 19, 15),
      recordedAt: at(now, 2, 19, 30),
      recordedBy: CAREGIVER,
    },
    {
      ...BLANK,
      id: 'e3',
      kind: 'incident',
      clientName: 'Ana Patient',
      title: 'Incident: Bathroom',
      location: 'Bathroom',
      severity: 'moderate',
      notes: 'Slipped on the wet floor getting out of the shower. Did not hit her head.',
      actionTaken: 'Helped her up, checked for injuries, called her daughter. Put a mat down.',
      witnessName: 'Sam Caregiver',
      occurredAt: at(now, 1, 9, 10),
      recordedAt: at(now, 1, 9, 25),
      recordedBy: CAREGIVER,
      // Shows what an edited entry looks like.
      editedAt: at(now, 1, 11, 0),
      editedBy: CAREGIVER,
    },
  ];
}

/**
 * Made-up entries kept in memory, for running the app with no server. The demo
 * caregiver looks after the demo patient, so both see the same list. Anyone
 * else gets their own empty list. Lost on reload. Used in development builds only.
 */
export class DemoRecordEntryService implements IRecordEntryService {
  private readonly byPatient = new Map<string, RecordEntry[]>();
  private nextId = 100;

  constructor(
    private readonly latencyMs = 300,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.byPatient.set(DEMO_PATIENT_ID, seed(clock()));
  }

  /** The caregiver's records are the patient's records. */
  private patientFor(personId: string): string {
    return personId === DEMO_CAREGIVER_ID ? DEMO_PATIENT_ID : personId;
  }

  private pause(): Promise<void> {
    return this.latencyMs > 0 ? new Promise((resolve) => setTimeout(resolve, this.latencyMs)) : Promise.resolve();
  }

  async list(viewerId: string): Promise<readonly RecordEntry[]> {
    await this.pause();
    return [...(this.byPatient.get(this.patientFor(viewerId)) ?? [])];
  }

  async add(author: EntryAuthor, input: RecordEntryInput): Promise<RecordEntry> {
    await this.pause();
    const entry: RecordEntry = {
      ...input,
      id: `e${this.nextId++}`,
      recordedAt: this.clock().toISOString(),
      recordedBy: author,
      editedAt: null,
      editedBy: null,
    };
    const key = this.patientFor(author.id);
    this.byPatient.set(key, [...(this.byPatient.get(key) ?? []), entry]);
    return entry;
  }

  async update(author: EntryAuthor, entryId: string, input: RecordEntryInput): Promise<RecordEntry> {
    await this.pause();
    const key = this.patientFor(author.id);
    const list = this.byPatient.get(key) ?? [];
    const old = list.find((entry) => entry.id === entryId);
    if (!old) throw new Error('Record not found.');
    // Only the person who wrote it can change it.
    if (old.recordedBy.id !== author.id) throw new Error('Record not found.');
    const entry: RecordEntry = {
      ...input,
      id: old.id,
      recordedAt: old.recordedAt,
      recordedBy: old.recordedBy,
      editedAt: this.clock().toISOString(),
      editedBy: author,
    };
    this.byPatient.set(key, list.map((item) => (item.id === entryId ? entry : item)));
    return entry;
  }
}
