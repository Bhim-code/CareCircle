import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiClient } from '../src/infrastructure/http/ApiClient';
import { ApiError } from '../src/infrastructure/http/ApiError';
import { HttpCareTaskService } from '../src/infrastructure/http/HttpCareTaskService';
import { TokenStore } from '../src/infrastructure/http/TokenStore';
import { MemorySessionStorage } from '../src/infrastructure/storage/MemorySessionStorage';

const BASE = 'https://api.test';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Call { url: string; method: string; body: unknown; auth: string | undefined }

async function setup(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const tokens = new TokenStore(new MemorySessionStorage());
  await tokens.set({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  const api = new ApiClient({
    baseUrl: BASE,
    tokens,
    fetch: (async (input: string, init: RequestInit = {}) => {
      const call: Call = {
        url: String(input).replace(BASE, ''),
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
        auth: (init.headers as Record<string, string>).Authorization,
      };
      calls.push(call);
      return handler(call);
    }) as unknown as typeof fetch,
  });
  return { service: new HttpCareTaskService(api), calls };
}

const ANA = { id: 'p-1', name: 'Ana Patient', role: 'patient' };
const SAM = { id: 'c-1', name: 'Sam Caregiver', role: 'caregiver' };
const DAY = {
  patient: ANA,
  day: '2026-11-06',
  counts: { done: 1, late: 0, skipped: 0, missed: 0, due: 1, upcoming: 0 },
  tasks: [
    { taskId: 't-1', title: 'Morning check-in', instructions: 'Say hello', time: '09:00', dueAt: '2026-11-06T13:30:00Z', status: 'done',
      completion: { status: 'done', reason: null, note: null, doneBy: SAM, doneAt: '2026-11-06T13:02:00Z' } },
    { taskId: 't-2', title: 'Tidy the kitchen', instructions: null, time: null, dueAt: null, status: 'due', completion: null },
  ],
  extras: [{ id: 'x-1', title: 'Walk to the park', note: null, doneBy: SAM, doneAt: '2026-11-06T18:00:00Z' }],
};

describe('HttpCareTaskService.listDay', () => {
  it("reads each client's day with tasks, marks, extra work and counts", async () => {
    const { service, calls } = await setup(() => json(200, [DAY]));
    const days = await service.listDay('u');
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['GET /tasks']);
    assert.equal(calls[0].auth, 'Bearer access-1');
    assert.equal(days.length, 1);
    assert.equal(days[0].client.name, 'Ana Patient');
    assert.equal(days[0].tasks[0].mark?.doneBy.name, 'Sam Caregiver');
    assert.equal(days[0].tasks[1].mark, null);
    assert.equal(days[0].tasks[1].time, null);
    assert.equal(days[0].extras[0].title, 'Walk to the park');
    assert.equal(days[0].counts.due, 1);
  });

  it('asks for a given day when there is one', async () => {
    const { service, calls } = await setup(() => json(200, []));
    await service.listDay('u', '2026-11-05');
    assert.equal(calls[0].url, '/tasks?day=2026-11-05');
  });

  it('returns an empty list when nobody is linked', async () => {
    const { service } = await setup(() => json(200, []));
    assert.deepEqual(await service.listDay('u'), []);
  });

  it('refuses an answer that is not a list, or a task it cannot read, instead of hiding it', async () => {
    await assert.rejects((await setup(() => json(200, { nope: true }))).service.listDay('u'), (e: ApiError) => e.code === 'bad_response');
    const broken = { ...DAY, tasks: [...DAY.tasks, { taskId: 't-3', title: 'Bad', status: 'wizard', time: null }] };
    await assert.rejects((await setup(() => json(200, [broken]))).service.listDay('u'), (e: ApiError) => e.code === 'bad_response');
    const badTime = { ...DAY, tasks: [{ ...DAY.tasks[1], time: '9am' }] };
    await assert.rejects((await setup(() => json(200, [badTime]))).service.listDay('u'), (e: ApiError) => e.code === 'bad_response');
  });

  it('passes the backend error along, such as 403 forbidden', async () => {
    const { service } = await setup(() => json(403, { error: { code: 'forbidden', message: 'No.' } }));
    await assert.rejects(service.listDay('u'), (e: ApiError) => e.status === 403 && e.code === 'forbidden');
  });
});

describe('HttpCareTaskService.mark', () => {
  it('marks a task done and returns the updated day', async () => {
    const { service, calls } = await setup(() => json(201, DAY));
    const day = await service.mark('u', 't-2', '2026-11-06', { status: 'done' });
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, '/tasks/t-2/complete');
    assert.deepEqual(calls[0].body, { day: '2026-11-06', status: 'done' });
    assert.equal(day.client.id, 'p-1');
  });

  it('sends the reason for a skip, and a note when there is one', async () => {
    const { service, calls } = await setup(() => json(201, DAY));
    await service.mark('u', 't-2', '2026-11-06', { status: 'skipped', reason: 'Ana was resting', note: 'asleep' });
    assert.deepEqual(calls[0].body, { day: '2026-11-06', status: 'skipped', reason: 'Ana was resting', note: 'asleep' });
  });

  it('escapes the id in the address', async () => {
    const { service, calls } = await setup(() => json(201, DAY));
    await service.mark('u', 'a/b', '2026-11-06', { status: 'done' });
    assert.equal(calls[0].url, '/tasks/a%2Fb/complete');
  });

  it('reports "already marked" with its code and sentence', async () => {
    const { service } = await setup(() => json(409, { error: { code: 'already_marked', message: 'This task is already marked for that day.' } }));
    await assert.rejects(service.mark('u', 't', '2026-11-06', { status: 'done' }), (e: ApiError) => e.status === 409 && e.code === 'already_marked');
  });
});

describe('HttpCareTaskService.undo and addExtra', () => {
  it('takes back a mark with DELETE and the day in the address', async () => {
    const { service, calls } = await setup(() => new Response(null, { status: 204 }));
    await service.undo('u', 't-1', '2026-11-06');
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['DELETE /tasks/t-1/complete?day=2026-11-06']);
    assert.equal(calls[0].body, undefined);
  });

  it('adds extra work, naming the client only when asked', async () => {
    const { service, calls } = await setup(() => json(201, DAY.extras[0]));
    const extra = await service.addExtra('u', { title: 'Walk to the park', note: 'sunny', clientId: 'p-1' });
    assert.equal(extra.id, 'x-1');
    assert.equal(calls[0].url, '/tasks/extra');
    assert.deepEqual(calls[0].body, { title: 'Walk to the park', note: 'sunny', patientId: 'p-1' });
    await service.addExtra('u', { title: 'Tidy' });
    assert.deepEqual(calls[1].body, { title: 'Tidy' });
  });
});
