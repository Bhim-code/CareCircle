import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  blankMedicineDraft,
  isMedicineActive,
  medicineDatesText,
  scheduleText,
  sortMedicines,
  validateMedicineDraft,
} from '../src/application/medicines';
import { dayKey } from '../src/application/reminders';
import { describeServiceError } from '../src/application/describeServiceError';
import type { Medicine } from '../src/domain/entities/Medicine';
import { DemoMedicineService } from '../src/infrastructure/demo/DemoMedicineService';
import { DemoReminderService } from '../src/infrastructure/demo/DemoReminderService';
import { DEMO_PATIENT_ID } from '../src/infrastructure/demo/demoIds';
import { ApiClient } from '../src/infrastructure/http/ApiClient';
import { ApiError } from '../src/infrastructure/http/ApiError';
import { HttpMedicineService } from '../src/infrastructure/http/HttpMedicineService';
import { TokenStore } from '../src/infrastructure/http/TokenStore';
import { MemorySessionStorage } from '../src/infrastructure/storage/MemorySessionStorage';

const NOW = new Date(2026, 9, 29, 10, 0, 0); // 29 Oct 2026, 10:00 local

function draft(over: Partial<ReturnType<typeof blankMedicineDraft>> = {}) {
  return { ...blankMedicineDraft(NOW), name: 'Metformin', times: ['8:00 AM'], ...over };
}

describe('validateMedicineDraft', () => {
  it('accepts a good form and turns it into the backend shape', () => {
    const result = validateMedicineDraft(draft({ times: ['8:30 PM', '8:00 AM'] }), NOW);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.input, {
        name: 'Metformin',
        times: ['08:00', '20:30'],
        startDate: '2026-10-29',
        endDate: null,
      });
    }
  });

  it('asks for a name and at least one time', () => {
    const result = validateMedicineDraft(draft({ name: '  ', times: [''] }), NOW);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errors.name, "Enter the medicine's name.");
      assert.equal(result.errors.times, 'Add at least one time.');
    }
  });

  it('points at the exact time box that is wrong or repeated', () => {
    const result = validateMedicineDraft(draft({ times: ['8:00 AM', 'soon', '08:00'] }), NOW);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errors.timeAt?.[0], undefined);
      assert.equal(result.errors.timeAt?.[1], 'Write a time like 8:00 AM or 20:30.');
      assert.equal(result.errors.timeAt?.[2], 'This time is already listed.');
    }
  });

  it('checks the dates', () => {
    const before = validateMedicineDraft(draft({ endDate: '2026-10-01' }), NOW);
    assert.equal(before.ok, false);
    if (!before.ok) assert.equal(before.errors.endDate, 'The end date cannot be before the start date.');

    const passed = validateMedicineDraft(draft({ startDate: '2026-09-01', endDate: '2026-10-01' }), NOW);
    assert.equal(passed.ok, false);
    if (!passed.ok) assert.equal(passed.errors.endDate, 'The end date has already passed.');

    const bad = validateMedicineDraft(draft({ startDate: 'tomorrow' }), NOW);
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.ok(bad.errors.startDate);

    const fine = validateMedicineDraft(draft({ endDate: '2026-11-05' }), NOW);
    assert.equal(fine.ok, true);
    if (fine.ok) assert.equal(fine.input.endDate, '2026-11-05');
  });
});

describe('medicine list helpers', () => {
  const base = { times: ['08:00'], startDate: '2026-10-01', endDate: null, stoppedAt: null };
  const active: Medicine = { id: 'a', name: 'Zinc', ...base };
  const stopped: Medicine = { id: 'b', name: 'Aspirin', ...base, stoppedAt: '2026-10-20T12:00:00.000Z' };
  const ended: Medicine = { id: 'c', name: 'Cough syrup', ...base, endDate: '2026-10-10' };
  const alsoActive: Medicine = { id: 'd', name: 'Calcium', ...base };

  it('tells active from stopped and ended', () => {
    assert.equal(isMedicineActive(active, '2026-10-29'), true);
    assert.equal(isMedicineActive(stopped, '2026-10-29'), false);
    assert.equal(isMedicineActive(ended, '2026-10-29'), false);
    assert.equal(isMedicineActive({ ...ended, endDate: '2026-10-29' }, '2026-10-29'), true);
  });

  it('lists active medicines first, each group in alphabetical order', () => {
    const order = sortMedicines([stopped, active, ended, alsoActive], '2026-10-29').map((m) => m.name);
    assert.deepEqual(order, ['Calcium', 'Zinc', 'Aspirin', 'Cough syrup']);
  });

  it('writes the schedule and dates in plain words', () => {
    assert.equal(scheduleText(['08:00', '20:30']), '8:00 AM, 8:30 PM');
    assert.equal(medicineDatesText(active, '2026-10-29'), 'Every day from Oct 1, 2026');
    assert.equal(medicineDatesText({ ...active, endDate: '2026-11-05' }, '2026-10-29'), 'Every day from Oct 1, 2026 until Nov 5, 2026');
    assert.equal(medicineDatesText(ended, '2026-10-29'), 'Ended on Oct 10, 2026');
    assert.match(medicineDatesText(stopped, '2026-10-29'), /^Stopped on Oct (19|20|21), 2026$/);
  });
});

describe('describeServiceError', () => {
  it('gives a useful sentence for each kind of failure', () => {
    assert.match(describeServiceError(new ApiError(0, 'network', 'x')), /Cannot reach the server/);
    assert.match(describeServiceError(new ApiError(429, 'too_many_requests', 'x')), /Too many requests/);
    assert.match(describeServiceError(new ApiError(401, 'session_expired', 'x')), /sign-in has ended/);
    assert.match(describeServiceError(new ApiError(403, 'forbidden', 'x')), /not allowed/);
    assert.match(describeServiceError(new Error('boom')), /could not save/);
    assert.match(describeServiceError(undefined), /could not save/);
  });
});

// ------------------------------------------------------------ HTTP service

const BASE = 'https://api.test';
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function httpSetup(handler: (url: string, method: string, body: unknown) => Response) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const tokens = new TokenStore(new MemorySessionStorage());
  await tokens.set({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  const api = new ApiClient({
    baseUrl: BASE,
    tokens,
    fetch: (async (input: string, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      const call = { url: String(input).replace(BASE, ''), method: init.method ?? 'GET', body };
      calls.push(call);
      return handler(call.url, call.method, body);
    }) as unknown as typeof fetch,
  });
  return { service: new HttpMedicineService(api), calls };
}

const ROW = { id: 'm-1', name: 'Metformin', times: ['20:30', '08:00'], startDate: '2026-10-29', endDate: null, stoppedAt: null };

describe('HttpMedicineService', () => {
  it('lists medicines with their times in order', async () => {
    const { service, calls } = await httpSetup(() => json(200, [ROW]));
    const list = await service.list('u');
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['GET /medicines']);
    assert.deepEqual(list, [{ ...ROW, times: ['08:00', '20:30'] }]);
  });

  it('adds a medicine, sending an end date only when there is one', async () => {
    const { service, calls } = await httpSetup(() => json(201, ROW));
    const created = await service.add('u', { name: 'Metformin', times: ['08:00'], startDate: '2026-10-29', endDate: null });
    assert.equal(created.id, 'm-1');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, '/medicines');
    assert.deepEqual(calls[0].body, { name: 'Metformin', times: ['08:00'], startDate: '2026-10-29' });

    await service.add('u', { name: 'Metformin', times: ['08:00'], startDate: '2026-10-29', endDate: '2026-11-05' });
    assert.equal((calls[1].body as { endDate: string }).endDate, '2026-11-05');
  });

  it('stops a medicine with DELETE', async () => {
    const { service, calls } = await httpSetup(() => new Response(null, { status: 204 }));
    await service.stop('u', 'm-1');
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['DELETE /medicines/m-1']);
  });

  it('refuses a list with one unreadable medicine instead of hiding it', async () => {
    const { service } = await httpSetup(() => json(200, [ROW, { ...ROW, id: 'm-2', times: ['8am'] }]));
    await assert.rejects(service.list('u'), (error: ApiError) => error.code === 'bad_response');
  });

  it('passes the backend error code along', async () => {
    const { service } = await httpSetup(() => json(403, { error: { code: 'forbidden', message: 'No.' } }));
    await assert.rejects(service.list('u'), (error: ApiError) => error.code === 'forbidden');
  });
});

// ------------------------------------------------------------ demo services

describe('DemoMedicineService and the demo reminders', () => {
  it('starts with the four demo medicines and only for the demo patient', async () => {
    const medicines = new DemoMedicineService(0);
    assert.equal((await medicines.list(DEMO_PATIENT_ID)).length, 4);
    assert.deepEqual(await medicines.list('someone-else'), []);
    await assert.rejects(medicines.add('someone-else', { name: 'X', times: ['08:00'], startDate: '2026-10-29', endDate: null }));
  });

  it('adds and stops, and stopping twice is harmless', async () => {
    const medicines = new DemoMedicineService(0);
    const created = await medicines.add(DEMO_PATIENT_ID, { name: 'Iron', times: ['22:00', '07:00'], startDate: '2026-10-29', endDate: null });
    assert.deepEqual(created.times, ['07:00', '22:00']);
    await medicines.stop(DEMO_PATIENT_ID, created.id);
    await medicines.stop(DEMO_PATIENT_ID, created.id);
    const found = (await medicines.list(DEMO_PATIENT_ID)).find((m) => m.id === created.id);
    assert.ok(found?.stoppedAt);
    await assert.rejects(medicines.stop(DEMO_PATIENT_ID, 'nope'));
  });

  it("makes the demo doses from the medicines, and drops a stopped one from the days after", async () => {
    const medicines = new DemoMedicineService(0);
    const reminders = new DemoReminderService(0, medicines);
    const today = dayKey(new Date());
    const tomorrow = dayKey(new Date(Date.now() + 24 * 60 * 60 * 1000));

    const before = await reminders.listForDay(DEMO_PATIENT_ID, today);
    assert.equal(before.length, 4);
    assert.ok(before.every((r) => r.id.includes('demo-med-')));
    assert.equal((await reminders.listForDay(DEMO_PATIENT_ID, tomorrow)).length, 4);

    await medicines.stop(DEMO_PATIENT_ID, 'demo-med-2');

    // Tomorrow never has a dose of a stopped medicine, whatever time it is now.
    const after = await reminders.listForDay(DEMO_PATIENT_ID, tomorrow);
    assert.equal(after.length, 3);
    assert.equal(after.some((r) => r.medicineName === 'Metformin'), false);
    // Today keeps doses whose time has already passed, so the history stays true.
    const todayAfter = await reminders.listForDay(DEMO_PATIENT_ID, today);
    assert.ok(todayAfter.length === 3 || todayAfter.length === 4);
  });
});
