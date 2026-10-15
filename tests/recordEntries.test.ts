import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FIELDS_FOR_KIND,
  addableKinds,
  blankDraft,
  canEditEntry,
  countEntries,
  draftFromEntry,
  editedNote,
  filterEntries,
  formatStamp,
  parseDateText,
  parseTimeText,
  sortEntries,
  validateDraft,
  type EntryDraft,
} from '../src/application/recordEntries';
import { policyFor } from '../src/application/policies/policyFor';
import type { AuthUser } from '../src/domain/entities/AuthUser';
import { ENTRY_KINDS, type EntryAuthor } from '../src/domain/entities/RecordEntry';
import { DEMO_CAREGIVER_ID, DEMO_PATIENT_ID } from '../src/infrastructure/demo/demoIds';
import { DemoRecordEntryService } from '../src/infrastructure/demo/DemoRecordEntryService';
import { EmptyRecordEntryService } from '../src/infrastructure/supabase/EmptyRecordEntryService';

const NOW = new Date(2026, 9, 15, 14, 30); // Oct 15 2026, 2:30 PM local

const patient: AuthUser = { id: DEMO_PATIENT_ID, email: 'patient@demo.test', name: 'Ana Patient', role: 'patient' };
const caregiver: AuthUser = { id: DEMO_CAREGIVER_ID, email: 'caregiver@demo.test', name: 'Sam Caregiver', role: 'caregiver' };
const asAuthor = (u: AuthUser): EntryAuthor => ({ id: u.id, name: u.name, role: u.role });

const filled = (user: AuthUser, changes: Partial<EntryDraft>): EntryDraft => ({ ...blankDraft(user, NOW), clientName: 'Ana Patient', ...changes });

describe('who can write which kind', () => {
  it('patients write medical, incident and medication records', () => {
    assert.deepEqual(addableKinds(policyFor('patient')), ['medical', 'incident', 'medication']);
  });
  it('caregivers write behavioural, incident and medication records', () => {
    assert.deepEqual(addableKinds(policyFor('caregiver')), ['behavioural', 'incident', 'medication']);
  });
  it('both roles can file an incident and see the written records', () => {
    for (const role of ['patient', 'caregiver'] as const) {
      assert.equal(policyFor(role).can('entries.incident'), true);
      assert.equal(policyFor(role).can('entries.view'), true);
    }
  });
  it('a patient cannot write behavioural records and a caregiver cannot write medical ones', () => {
    assert.equal(policyFor('patient').can('entries.behavioural'), false);
    assert.equal(policyFor('caregiver').can('entries.medical'), false);
  });
});

describe('parsing date and time', () => {
  it('reads real dates and rejects impossible ones', () => {
    assert.deepEqual(parseDateText('2026-10-15'), { year: 2026, month: 10, day: 15 });
    assert.equal(parseDateText('2026-02-30'), null);
    assert.equal(parseDateText('15/10/2026'), null);
    assert.equal(parseDateText(''), null);
  });
  it('reads 24-hour and AM/PM times', () => {
    assert.deepEqual(parseTimeText('14:30'), { hours: 14, minutes: 30 });
    assert.deepEqual(parseTimeText('2:30 PM'), { hours: 14, minutes: 30 });
    assert.deepEqual(parseTimeText('2:30pm'), { hours: 14, minutes: 30 });
    assert.deepEqual(parseTimeText('12:05 AM'), { hours: 0, minutes: 5 });
    assert.deepEqual(parseTimeText('12:05 PM'), { hours: 12, minutes: 5 });
  });
  it('rejects times that do not exist', () => {
    assert.equal(parseTimeText('25:00'), null);
    assert.equal(parseTimeText('10:75'), null);
    assert.equal(parseTimeText('13:00 PM'), null);
    assert.equal(parseTimeText('soon'), null);
  });
  it('writes a readable stamp', () => {
    assert.equal(formatStamp(NOW.toISOString()), 'Oct 15, 2026 at 2:30 PM');
  });
});

describe('the blank form', () => {
  it('fills in a patient’s own name and the current date and time', () => {
    const draft = blankDraft(patient, NOW);
    assert.equal(draft.clientName, 'Ana Patient');
    assert.equal(draft.date, '2026-10-15');
    assert.equal(draft.time, '14:30');
  });
  it('leaves the client blank for a caregiver to fill in', () => {
    assert.equal(blankDraft(caregiver, NOW).clientName, '');
  });
});

describe('checking the form', () => {
  it('accepts a complete incident with a witness and builds the saved entry', () => {
    const result = validateDraft(
      'incident',
      filled(caregiver, { notes: ' Slipped in the bathroom ', severity: 'moderate', location: 'Bathroom', witnessName: 'Maria', actionTaken: 'Helped up' }),
      NOW,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.kind, 'incident');
    assert.equal(result.input.clientName, 'Ana Patient');
    assert.equal(result.input.notes, 'Slipped in the bathroom');
    assert.equal(result.input.witnessName, 'Maria');
    assert.equal(result.input.severity, 'moderate');
    assert.equal(result.input.title, 'Incident: Bathroom');
    assert.equal(new Date(result.input.occurredAt).getTime(), NOW.getTime());
  });
  it('treats the witness as optional', () => {
    const result = validateDraft('incident', filled(patient, { notes: 'Fell', severity: 'minor' }), NOW);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.input.witnessName, null);
  });
  it('requires client, description and seriousness for an incident', () => {
    const result = validateDraft('incident', filled(patient, { clientName: ' ' }), NOW);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.clientName);
    assert.ok(result.errors.notes);
    assert.ok(result.errors.severity);
  });
  it('requires a mood for a behavioural record and a subject for a medical one', () => {
    const behavioural = validateDraft('behavioural', filled(caregiver, {}), NOW);
    assert.equal(behavioural.ok, false);
    if (!behavioural.ok) assert.ok(behavioural.errors.mood);
    const medical = validateDraft('medical', filled(patient, {}), NOW);
    assert.equal(medical.ok, false);
    if (!medical.ok) assert.ok(medical.errors.title);
  });
  it('requires a medicine name for a medication record, and keeps the photo', () => {
    const missing = validateDraft('medication', filled(patient, {}), NOW);
    assert.equal(missing.ok, false);
    const ok = validateDraft('medication', filled(patient, { medicineName: 'Metformin', photoUri: 'file:///photo.jpg' }), NOW);
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.input.photoUri, 'file:///photo.jpg');
      assert.equal(ok.input.title, 'Metformin');
    }
  });
  it('rejects a time in the future and a badly written date or time', () => {
    const future = validateDraft('medical', filled(patient, { title: 'x', date: '2026-10-16' }), NOW);
    assert.equal(future.ok, false);
    if (!future.ok) assert.ok(future.errors.date);
    const bad = validateDraft('medical', filled(patient, { title: 'x', date: 'today', time: 'noon' }), NOW);
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.ok(bad.errors.date);
      assert.ok(bad.errors.time);
    }
  });
  it('drops fields that do not belong to the kind', () => {
    const result = validateDraft('medical', filled(patient, { title: 'Headache', witnessName: 'X', mood: 'calm', medicineName: 'Y', photoUri: 'file:///p.jpg' }), NOW);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.witnessName, null);
    assert.equal(result.input.mood, null);
    assert.equal(result.input.medicineName, null);
    assert.equal(result.input.photoUri, null);
  });
  it('every kind lists a client name, date and time', () => {
    for (const kind of ENTRY_KINDS) {
      for (const field of ['clientName', 'date', 'time'] as const) assert.ok(FIELDS_FOR_KIND[kind].includes(field), `${kind} ${field}`);
    }
  });
});

describe('the demo service', () => {
  const make = () => new DemoRecordEntryService(0, () => NOW);

  it('gives the caregiver the same list as the patient', async () => {
    const service = make();
    const forPatient = await service.list(DEMO_PATIENT_ID);
    const forCaregiver = await service.list(DEMO_CAREGIVER_ID);
    assert.ok(forPatient.length >= 3);
    assert.deepEqual(forCaregiver, forPatient);
  });
  it('keeps everyone else’s list separate and empty', async () => {
    const service = make();
    assert.deepEqual(await service.list('someone-else'), []);
    await service.add({ id: 'someone-else', name: 'Else', role: 'patient' }, {
      ...(validated('medical', patient) ?? ({} as never)),
    });
    assert.equal((await service.list('someone-else')).length, 1);
    assert.equal((await service.list(DEMO_PATIENT_ID)).length, 3);
  });
  it('stamps who recorded an entry and when, and shows it to the other side', async () => {
    const service = make();
    const saved = await service.add(asAuthor(caregiver), validated('incident', caregiver)!);
    assert.equal(saved.recordedBy.name, 'Sam Caregiver');
    assert.equal(saved.recordedAt, NOW.toISOString());
    assert.equal(saved.editedAt, null);
    assert.equal((await service.list(DEMO_PATIENT_ID)).some((e) => e.id === saved.id), true);
  });
  it('marks an edited entry, keeping the original recorded time and author', async () => {
    const later = new Date(2026, 9, 15, 16, 0);
    let clock = NOW;
    const service = new DemoRecordEntryService(0, () => clock);
    const saved = await service.add(asAuthor(patient), validated('medical', patient)!);
    clock = later;
    const changed = await service.update(asAuthor(patient), saved.id, { ...validated('medical', patient)!, notes: 'Updated details' });
    assert.equal(changed.notes, 'Updated details');
    assert.equal(changed.recordedAt, saved.recordedAt);
    assert.equal(changed.recordedBy.id, patient.id);
    assert.equal(changed.editedAt, later.toISOString());
    assert.match(editedNote(changed) ?? '', /^Edited Oct 15, 2026 at 4:00 PM by Ana Patient$/);
    assert.equal(editedNote(saved), null);
  });
  it('lets only the author edit', async () => {
    const service = make();
    const saved = await service.add(asAuthor(patient), validated('medical', patient)!);
    await assert.rejects(service.update(asAuthor(caregiver), saved.id, validated('medical', patient)!));
    await assert.rejects(service.update(asAuthor(patient), 'nope', validated('medical', patient)!));
  });
  it('includes one already-edited entry so the mark can be seen', async () => {
    const entries = await make().list(DEMO_PATIENT_ID);
    assert.equal(entries.filter((e) => e.editedAt).length, 1);
  });
});

describe('the Empty service (real backend not built yet)', () => {
  it('lists nothing and refuses to save', async () => {
    const service = new EmptyRecordEntryService();
    assert.deepEqual(await service.list('x'), []);
    await assert.rejects(service.add(asAuthor(patient), validated('medical', patient)!));
  });
});

describe('editing rules, lists and editing from draft', () => {
  it('only the author may edit, and only for a kind their role may write', async () => {
    const service = new DemoRecordEntryService(0, () => NOW);
    const entries = await service.list(DEMO_PATIENT_ID);
    const ownMedical = entries.find((e) => e.kind === 'medical')!; // written by the patient
    const careIncident = entries.find((e) => e.kind === 'incident')!; // written by the caregiver
    assert.equal(canEditEntry(policyFor('patient'), patient, ownMedical), true);
    assert.equal(canEditEntry(policyFor('caregiver'), caregiver, ownMedical), false);
    assert.equal(canEditEntry(policyFor('caregiver'), caregiver, careIncident), true);
    assert.equal(canEditEntry(policyFor('patient'), patient, careIncident), false);
  });
  it('sorts newest first, filters by kind and counts', async () => {
    const entries = await new DemoRecordEntryService(0, () => NOW).list(DEMO_PATIENT_ID);
    const sorted = sortEntries(entries);
    assert.deepEqual(sorted.map((e) => e.kind), ['incident', 'behavioural', 'medical']);
    assert.equal(filterEntries(entries, 'incident').length, 1);
    assert.equal(filterEntries(entries, 'all').length, 3);
    assert.deepEqual(countEntries(entries), { all: 3, medical: 1, behavioural: 1, incident: 1, medication: 0 });
  });
  it('turns a saved entry back into a form that validates the same', async () => {
    const entries = await new DemoRecordEntryService(0, () => NOW).list(DEMO_PATIENT_ID);
    const incident = entries.find((e) => e.kind === 'incident')!;
    const result = validateDraft('incident', draftFromEntry(incident), new Date(2030, 0, 1));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.input.witnessName, incident.witnessName);
      assert.equal(result.input.occurredAt, incident.occurredAt);
    }
  });
});

function validated(kind: (typeof ENTRY_KINDS)[number], user: AuthUser) {
  const draft = filled(user, {
    title: 'Headache',
    notes: 'Notes here',
    severity: 'minor',
    mood: 'calm',
    medicineName: 'Metformin',
  });
  const result = validateDraft(kind, draft, NOW);
  return result.ok ? result.input : null;
}
