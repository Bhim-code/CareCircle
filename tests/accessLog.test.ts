import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeAccessLogError, describeAction, describeRole, dayLabel, groupByDay, timeLabel } from '../src/application/accessLog';
import type { AccessView } from '../src/domain/entities/AccessView';
import { DemoAccessLogService } from '../src/infrastructure/demo/DemoAccessLogService';
import { ApiClient } from '../src/infrastructure/http/ApiClient';
import { ApiError } from '../src/infrastructure/http/ApiError';
import { HttpAccessLogService, toAccessView } from '../src/infrastructure/http/HttpAccessLogService';
import { TokenStore } from '../src/infrastructure/http/TokenStore';
import { MemorySessionStorage } from '../src/infrastructure/storage/MemorySessionStorage';

const SAM = { id: 'c-1', name: 'Sam Caregiver', role: 'caregiver' };
const view = (at: Date, action = 'entries.list'): AccessView => ({ at: at.toISOString(), viewer: SAM, action });
const NOW = new Date(2026, 10, 7, 13, 0);

describe('describeAction and describeRole', () => {
  it('says what was done in plain words', () => {
    assert.equal(describeAction('entries.list'), 'Read your care notes');
    assert.equal(describeAction('documents.upload'), 'Added a health document');
  });
  it('never shows a code it does not know', () => {
    assert.equal(describeAction('something.new'), 'Looked at your information');
  });
  it('names roles, with a safe fallback', () => {
    assert.equal(describeRole('caregiver'), 'Caregiver');
    assert.equal(describeRole('admin'), 'Administrator');
    assert.equal(describeRole('robot'), 'Staff member');
  });
});

describe('dayLabel and timeLabel', () => {
  it('uses Today, Yesterday, then dates', () => {
    assert.equal(dayLabel(new Date(2026, 10, 7, 1, 0).toISOString(), NOW), 'Today');
    assert.equal(dayLabel(new Date(2026, 10, 6, 23, 0).toISOString(), NOW), 'Yesterday');
    assert.equal(dayLabel(new Date(2026, 9, 30, 9, 0).toISOString(), NOW), 'October 30');
    assert.equal(dayLabel(new Date(2025, 11, 25, 9, 0).toISOString(), NOW), 'December 25, 2025');
    assert.equal(dayLabel('garbage', NOW), 'Earlier');
  });
  it('writes the time of day in 12-hour form', () => {
    assert.equal(timeLabel(new Date(2026, 10, 7, 14, 5).toISOString()), '2:05 PM');
    assert.equal(timeLabel(new Date(2026, 10, 7, 0, 7).toISOString()), '12:07 AM');
    assert.equal(timeLabel(new Date(2026, 10, 7, 12, 0).toISOString()), '12:00 PM');
    assert.equal(timeLabel('garbage'), '');
  });
});

describe('groupByDay', () => {
  it('groups by day, newest first, whatever order they arrive in', () => {
    const a = view(new Date(2026, 10, 7, 9, 0));
    const b = view(new Date(2026, 10, 7, 12, 0));
    const c = view(new Date(2026, 10, 6, 20, 0));
    const days = groupByDay([c, a, b], NOW);
    assert.deepEqual(days.map((d) => d.label), ['Today', 'Yesterday']);
    assert.deepEqual(days[0].views, [b, a]);
    assert.deepEqual(days[1].views, [c]);
  });
  it('is empty for no views', () => {
    assert.deepEqual(groupByDay([], NOW), []);
  });
});

describe('describeAccessLogError', () => {
  it('explains the common failures', () => {
    assert.match(describeAccessLogError({ code: 'network' }), /Cannot reach/);
    assert.match(describeAccessLogError({ code: 'forbidden' }), /Only patients/);
    assert.match(describeAccessLogError(new Error('x')), /could not load/);
  });
});

describe('toAccessView', () => {
  it('reads what the backend sends and ignores extras', () => {
    assert.deepEqual(
      toAccessView({ at: '2026-11-07T10:00:00Z', viewer: { ...SAM, extra: 1 }, action: 'tasks.list', more: 2 }),
      { at: '2026-11-07T10:00:00Z', viewer: SAM, action: 'tasks.list' },
    );
  });
  it('rejects an answer it cannot read', () => {
    assert.throws(() => toAccessView({ at: 1, viewer: SAM, action: 'x' }), ApiError);
    assert.throws(() => toAccessView({ at: 'x', viewer: null, action: 'x' }), ApiError);
    assert.throws(() => toAccessView('nope'), ApiError);
  });
});

describe('HttpAccessLogService', () => {
  it('reads GET /me/access-log', async () => {
    const BASE = 'https://api.test';
    const calls: string[] = [];
    const tokens = new TokenStore(new MemorySessionStorage());
    await tokens.set({ accessToken: 'a', refreshToken: 'r' });
    const client = new ApiClient({
      baseUrl: BASE, tokens,
      fetch: (async (input: string, init: RequestInit = {}) => {
        calls.push(`${init.method ?? 'GET'} ${String(input).replace(BASE, '')}`);
        return new Response(JSON.stringify([{ at: '2026-11-07T10:00:00Z', viewer: SAM, action: 'tasks.list' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as unknown as typeof fetch,
    });
    const views = await new HttpAccessLogService(client).list('p-1');
    assert.deepEqual(calls, ['GET /me/access-log']);
    assert.equal(views.length, 1);
    assert.equal(views[0].viewer.name, 'Sam Caregiver');
  });
});

describe('DemoAccessLogService', () => {
  it('gives a few views, newest first, with readable actions', async () => {
    const views = await new DemoAccessLogService(() => NOW.getTime()).list('demo-patient@demo.test');
    assert.ok(views.length >= 3);
    for (let i = 1; i < views.length; i++) assert.ok(Date.parse(views[i - 1].at) >= Date.parse(views[i].at));
    for (const v of views) assert.notEqual(describeAction(v.action), 'Looked at your information');
  });
});
