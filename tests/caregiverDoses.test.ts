import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeDosesError, dosesFor, patientsOf, sortDoses } from '../src/application/caregiverDoses';
import { reminderStatus, summarizeToday } from '../src/application/reminders';
import type { PatientDose } from '../src/domain/entities/PatientDose';
import { DemoCaregiverDoseService } from '../src/infrastructure/demo/DemoCaregiverDoseService';
import { EmptyCaregiverDoseService } from '../src/infrastructure/supabase/EmptyCaregiverDoseService';
import { ApiClient } from '../src/infrastructure/http/ApiClient';
import { ApiError } from '../src/infrastructure/http/ApiError';
import { HttpCaregiverDoseService, toPatientDose } from '../src/infrastructure/http/HttpCaregiverDoseService';
import { TokenStore } from '../src/infrastructure/http/TokenStore';
import { MemorySessionStorage } from '../src/infrastructure/storage/MemorySessionStorage';

const dose = (over: Partial<PatientDose>): PatientDose => ({
  id: 'r-1', medicineName: 'Metformin', scheduledAt: '2026-11-10T16:30:00.000Z', acknowledged: false, skipped: false,
  patientId: 'p-1', patientName: 'Ana Patient', ...over,
});
const wire = (over: Record<string, unknown> = {}) => ({
  id: 'r-1', medicineName: 'Metformin', scheduledAt: '2026-11-10T16:30:00Z', acknowledged: false, skipped: false,
  status: 'upcoming', patientId: 'p-1', patientName: 'Ana Patient', ...over,
});

describe('sortDoses, patientsOf and dosesFor', () => {
  const a1 = dose({ id: 'a1', scheduledAt: '2026-11-10T09:00:00.000Z' });
  const b1 = dose({ id: 'b1', patientId: 'p-2', patientName: 'Bob Patient', scheduledAt: '2026-11-10T09:00:00.000Z' });
  const a2 = dose({ id: 'a2', scheduledAt: '2026-11-10T08:00:00.000Z' });
  it('sorts by time, then patient name', () => {
    assert.deepEqual(sortDoses([b1, a1, a2]).map((d) => d.id), ['a2', 'a1', 'b1']);
  });
  it('lists each patient once, by name', () => {
    assert.deepEqual(patientsOf([b1, a1, a2]), [{ id: 'p-1', name: 'Ana Patient' }, { id: 'p-2', name: 'Bob Patient' }]);
  });
  it('shows everyone, or one patient', () => {
    assert.equal(dosesFor([a1, b1, a2], null).length, 3);
    assert.deepEqual(dosesFor([a1, b1, a2], 'p-2').map((d) => d.id), ['b1']);
  });
  it('is empty for no doses', () => {
    assert.deepEqual(patientsOf([]), []);
    assert.deepEqual(sortDoses([]), []);
  });
});

describe('statuses for a caregiver', () => {
  const at = Date.parse('2026-11-10T16:30:00Z');
  it('works out due, missed, taken and skipped like the patient sees them', () => {
    const late = new Date(at + 3 * 3_600_000);
    assert.equal(reminderStatus(dose({}), late), 'missed');
    assert.equal(reminderStatus(dose({}), new Date(at + 60_000)), 'due');
    assert.equal(reminderStatus(dose({ acknowledged: true }), late), 'acknowledged');
    assert.equal(reminderStatus(dose({ skipped: true }), late), 'skipped');
  });
  it('counts missed doses across patients', () => {
    const late = new Date(at + 3 * 3_600_000);
    const summary = summarizeToday([dose({ id: 'a' }), dose({ id: 'b', patientId: 'p-2' }), dose({ id: 'c', acknowledged: true })], late);
    assert.equal(summary.total, 3);
    assert.equal(summary.missed, 2);
    assert.equal(summary.acknowledged, 1);
  });
});

describe('toPatientDose', () => {
  it('reads taken and skipped from the server status, and ignores extras', () => {
    assert.equal(toPatientDose(wire({ status: 'taken' })).acknowledged, true);
    assert.equal(toPatientDose(wire({ status: 'skipped' })).skipped, true);
    const open = toPatientDose(wire({ status: 'missed', extra: 1 }));
    assert.deepEqual([open.acknowledged, open.skipped, open.patientName], [false, false, 'Ana Patient']);
  });
  it('rejects a dose it cannot read', () => {
    for (const bad of [null, 'x', wire({ status: 'weird' }), wire({ patientId: 1 }), wire({ scheduledAt: 'nope' }), wire({ patientName: undefined })]) {
      assert.throws(() => toPatientDose(bad), ApiError);
    }
  });
});

const BASE = 'https://api.test';
async function setup(handler: (url: string, method: string) => Response) {
  const seen: string[] = [];
  const tokens = new TokenStore(new MemorySessionStorage());
  await tokens.set({ accessToken: 'a', refreshToken: 'r' });
  const api = new ApiClient({
    baseUrl: BASE, tokens,
    fetch: (async (input: string, init: RequestInit = {}) => {
      seen.push(`${init.method ?? 'GET'} ${String(input).replace(BASE, '')}`);
      return handler(String(input), init.method ?? 'GET');
    }) as unknown as typeof fetch,
  });
  return { service: new HttpCaregiverDoseService(api, () => 'America/St_Johns'), seen };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('HttpCaregiverDoseService', () => {
  it('asks for the day in the phone time zone and reads every patient\'s doses', async () => {
    const { service, seen } = await setup(() => json(200, [wire(), wire({ id: 'r-2', patientId: 'p-2', patientName: 'Bob', status: 'taken' })]));
    const doses = await service.listForDay('2026-11-10');
    assert.deepEqual(seen, ['GET /reminders?day=2026-11-10&timezone=America%2FSt_Johns']);
    assert.deepEqual(doses.map((d) => d.patientName), ['Ana Patient', 'Bob']);
  });
  it('fails on an answer that is not a list', async () => {
    const { service } = await setup(() => json(200, { nope: true }));
    await assert.rejects(service.listForDay('2026-11-10'), (e: ApiError) => e.code === 'bad_response');
  });
  it('fails when offline', async () => {
    const { service } = await setup(() => { throw new TypeError('Network request failed'); });
    await assert.rejects(service.listForDay('2026-11-10'), (e: ApiError) => e.code === 'network');
  });
  it('has no way to confirm or skip a dose', () => {
    assert.deepEqual(Object.getOwnPropertyNames(HttpCaregiverDoseService.prototype).sort(), ['constructor', 'listForDay']);
  });
});

describe('describeDosesError', () => {
  it('explains the common failures', () => {
    assert.match(describeDosesError({ code: 'network' }), /Cannot reach/);
    assert.match(describeDosesError({ code: 'session_expired' }), /sign-in/);
    assert.match(describeDosesError(new Error('x')), /could not load/);
  });
});

describe('demo and empty services', () => {
  it('the demo gives two patients\' doses for the day asked', async () => {
    const doses = await new DemoCaregiverDoseService(0).listForDay('2026-11-10');
    assert.equal(patientsOf(doses).length, 2);
    assert.ok(doses.every((d) => d.scheduledAt.length > 0));
    assert.ok(doses.some((d) => d.acknowledged) && doses.some((d) => !d.acknowledged));
  });
  it('the empty service has nothing', async () => {
    assert.deepEqual(await new EmptyCaregiverDoseService().listForDay('2026-11-10'), []);
  });
});
