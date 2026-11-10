import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reconcile, syncedPart, touchesSynced, withSynced } from '../src/application/preferences';
import { describeProfileError, validateNewName } from '../src/application/profile';
import { DEFAULT_PREFERENCES, type SyncedPreferences } from '../src/domain/entities/UserPreferences';
import type { IPreferencesSync } from '../src/domain/services/IPreferencesSync';
import { DemoProfileService } from '../src/infrastructure/demo/DemoProfileService';
import { ApiClient } from '../src/infrastructure/http/ApiClient';
import { ApiError } from '../src/infrastructure/http/ApiError';
import { HttpPreferencesSync } from '../src/infrastructure/http/HttpPreferencesSync';
import { HttpProfileService } from '../src/infrastructure/http/HttpProfileService';
import { TokenStore } from '../src/infrastructure/http/TokenStore';
import { MemoryPreferencesStore } from '../src/infrastructure/storage/MemoryPreferencesStore';
import { MemorySessionStorage } from '../src/infrastructure/storage/MemorySessionStorage';

const local = { ...DEFAULT_PREFERENCES, largerText: true, alarmSound: false, snoozeMinutes: 15 as const };
const server: SyncedPreferences = { largerText: false, reminderNotifications: false, missedDoseEmail: true, missedDoseCall: true };

function fakeSync(overrides: Partial<IPreferencesSync> = {}) {
  const calls: string[] = [];
  const sync: IPreferencesSync = {
    fetch: async () => {
      calls.push('fetch');
      return server;
    },
    push: async (p) => {
      calls.push('push');
      return p;
    },
    ...overrides,
  };
  return { sync, calls };
}

describe('synced settings', () => {
  it('sends the four switches and the three alarm settings', () => {
    assert.deepEqual(
      Object.keys(syncedPart(local)).sort(),
      ['alarmSound', 'alarmVibration', 'largerText', 'missedDoseCall', 'missedDoseEmail', 'reminderNotifications', 'snoozeMinutes'],
    );
  });
  it('keeps the phone alarm settings when the server leaves them out', () => {
    const merged = withSynced(local, server);
    assert.equal(merged.largerText, false);
    assert.equal(merged.missedDoseCall, true);
    assert.equal(merged.alarmSound, false);
    assert.equal(merged.snoozeMinutes, 15);
  });
  it('takes the alarm settings the server sends', () => {
    const merged = withSynced(local, { ...server, alarmSound: true, alarmVibration: false, snoozeMinutes: 5 });
    assert.equal(merged.alarmSound, true);
    assert.equal(merged.alarmVibration, false);
    assert.equal(merged.snoozeMinutes, 5);
  });
  it('keeps the phone snooze length when the server sends one the app does not offer', () => {
    assert.equal(withSynced(local, { ...server, snoozeMinutes: 7 }).snoozeMinutes, 15);
  });
  it('knows which changes reach the server', () => {
    assert.ok(touchesSynced({ largerText: true }));
    assert.ok(touchesSynced({ alarmSound: false }));
    assert.ok(touchesSynced({ snoozeMinutes: 5 }));
    assert.equal(touchesSynced({}), false);
  });
});

describe('reconcile', () => {
  it('takes the server settings on a phone with no unsent change (a new phone)', async () => {
    const { sync, calls } = fakeSync();
    const result = await reconcile(sync, local, false);
    assert.deepEqual(calls, ['fetch']);
    assert.ok(result.status === 'synced');
    assert.equal(result.preferences.missedDoseCall, true);
    assert.equal(result.preferences.largerText, false);
    assert.equal(result.preferences.snoozeMinutes, 15); // this server sent no alarm settings, so the phone's stay
  });
  it('gives a new phone the alarm settings from the account', async () => {
    const { sync } = fakeSync({ fetch: async () => ({ ...server, alarmSound: true, alarmVibration: false, snoozeMinutes: 5 }) });
    const result = await reconcile(sync, DEFAULT_PREFERENCES, false);
    assert.ok(result.status === 'synced');
    assert.equal(result.preferences.alarmVibration, false);
    assert.equal(result.preferences.snoozeMinutes, 5);
  });
  it('sends the phone settings when a change has not reached the server yet', async () => {
    const { sync, calls } = fakeSync();
    const result = await reconcile(sync, local, true);
    assert.deepEqual(calls, ['push']);
    assert.ok(result.status === 'synced' && result.preferences.largerText === true);
  });
  it('changes nothing when the server cannot be reached', async () => {
    const { sync } = fakeSync({ fetch: async () => { throw new ApiError(0, 'network', 'x'); }, push: async () => { throw new ApiError(0, 'network', 'x'); } });
    assert.equal((await reconcile(sync, local, false)).status, 'offline');
    assert.equal((await reconcile(sync, local, true)).status, 'offline');
  });
});

describe('MemoryPreferencesStore unsent marker', () => {
  it('remembers a change that has not reached the server, per person', async () => {
    const store = new MemoryPreferencesStore();
    assert.equal(await store.isDirty('a'), false);
    await store.setDirty('a', true);
    assert.equal(await store.isDirty('a'), true);
    assert.equal(await store.isDirty('b'), false);
    await store.setDirty('a', false);
    assert.equal(await store.isDirty('a'), false);
  });
});

const BASE = 'https://api.test';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function api(handler: (c: { url: string; method: string; body: any }) => Response) {
  const calls: { url: string; method: string; body: any }[] = [];
  const tokens = new TokenStore(new MemorySessionStorage());
  await tokens.set({ accessToken: 'a', refreshToken: 'r' });
  const client = new ApiClient({
    baseUrl: BASE, tokens,
    fetch: (async (input: string, init: RequestInit = {}) => {
      const c = { url: String(input).replace(BASE, ''), method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined };
      calls.push(c);
      return handler(c);
    }) as unknown as typeof fetch,
  });
  return { client, calls };
}

describe('HttpPreferencesSync', () => {
  it('reads the four switches', async () => {
    const { client, calls } = await api(() => json(200, { ...server, extra: 1 }));
    assert.deepEqual(await new HttpPreferencesSync(client).fetch(), server);
    assert.equal(calls[0].url, '/me/preferences');
  });
  it('sends all four on every save', async () => {
    const { client, calls } = await api((c) => json(200, c.body));
    const saved = await new HttpPreferencesSync(client).push({ ...server, largerText: true });
    assert.equal(calls[0].method, 'PUT');
    assert.deepEqual(calls[0].body, { ...server, largerText: true });
    assert.equal(saved.largerText, true);
  });
  it('reads and sends the alarm settings too', async () => {
    const alarm = { alarmSound: false, alarmVibration: true, snoozeMinutes: 15 as const };
    const { client, calls } = await api((c) => json(200, c.body ?? { ...server, ...alarm }));
    const sync = new HttpPreferencesSync(client);
    assert.deepEqual(await sync.fetch(), { ...server, ...alarm });
    await sync.push({ ...server, ...alarm });
    assert.deepEqual(calls[1].body, { ...server, ...alarm });
  });
  it('drops a snooze length the app does not offer, and a setting of the wrong kind', async () => {
    const { client } = await api(() => json(200, { ...server, alarmSound: 'yes', alarmVibration: true, snoozeMinutes: 7 }));
    assert.deepEqual(await new HttpPreferencesSync(client).fetch(), { ...server, alarmVibration: true });
  });
  it('rejects an answer it cannot read', async () => {
    const { client } = await api(() => json(200, { largerText: 'yes' }));
    await assert.rejects(new HttpPreferencesSync(client).fetch(), (e: { code?: string }) => e.code === 'bad_response');
  });
});

describe('profile name', () => {
  it('validates a new name', () => {
    assert.match(validateNewName('  ', 'Ana')!, /Enter your name/);
    assert.match(validateNewName('x'.repeat(81), 'Ana')!, /80/);
    assert.match(validateNewName(' Ana ', 'Ana')!, /already/);
    assert.equal(validateNewName('Ana B', 'Ana'), undefined);
  });
  it('saves it with PATCH /me, trimmed', async () => {
    const { client, calls } = await api((c) => json(200, { id: 'u', email: 'a@x.test', name: c.body.name, role: 'patient', timezone: 'UTC' }));
    assert.equal(await new HttpProfileService(client).updateName('  Ana B '), 'Ana B');
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(calls[0].url, '/me');
    assert.deepEqual(calls[0].body, { name: 'Ana B' });
  });
  it('the demo pretends to save', async () => {
    assert.equal(await new DemoProfileService(0).updateName(' Ana B '), 'Ana B');
  });
  it('explains a failure plainly', () => {
    assert.match(describeProfileError(new ApiError(0, 'network', 'x')), /connection/);
    assert.equal(describeProfileError(new ApiError(422, 'invalid', 'x', { fields: { name: 'Too long.' } })), 'Too long.');
    assert.match(describeProfileError(new Error('boom')), /try again/);
  });
});
