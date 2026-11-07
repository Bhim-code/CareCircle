import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PushTokenResult } from '../src/domain/entities/PushToken';
import { registerPush, unregisterPush, type PushDeps } from '../src/application/pushRegistration';
import { ApiClient } from '../src/infrastructure/http/ApiClient';
import { ApiError } from '../src/infrastructure/http/ApiError';
import { HttpPushTokenService } from '../src/infrastructure/http/HttpPushTokenService';
import { TokenStore } from '../src/infrastructure/http/TokenStore';
import { MemoryPushTokenStore } from '../src/infrastructure/storage/MemoryPushTokenStore';
import { MemorySessionStorage } from '../src/infrastructure/storage/MemorySessionStorage';

function fake(result: PushTokenResult, opts: { registerFails?: boolean; unregisterHangs?: boolean } = {}) {
  const calls: string[] = [];
  const store = new MemoryPushTokenStore();
  const deps: PushDeps = {
    source: { getToken: async () => result },
    server: {
      register: async (t) => {
        calls.push(`register ${t}`);
        if (opts.registerFails) throw new ApiError(0, 'network', 'x');
      },
      unregister: async (t) => {
        calls.push(`unregister ${t}`);
        if (opts.unregisterHangs) await new Promise(() => undefined);
      },
    },
    store,
  };
  return { deps, calls, store };
}

describe('registerPush', () => {
  it('gives the server the token and remembers it', async () => {
    const { deps, calls, store } = fake({ kind: 'token', token: 'ExponentPushToken[a]' });
    assert.equal(await registerPush(deps, 'u1'), 'registered');
    assert.deepEqual(calls, ['register ExponentPushToken[a]']);
    assert.equal(await store.get('u1'), 'ExponentPushToken[a]');
  });

  it('does not remember a token the server did not get, and reports offline', async () => {
    const { deps, store } = fake({ kind: 'token', token: 't' }, { registerFails: true });
    assert.equal(await registerPush(deps, 'u1'), 'offline');
    assert.equal(await store.get('u1'), null);
  });

  it('takes back the old token when the phone gets a new one', async () => {
    const { deps, calls, store } = fake({ kind: 'token', token: 'new' });
    await store.set('u1', 'old');
    assert.equal(await registerPush(deps, 'u1'), 'registered');
    assert.deepEqual(calls, ['register new', 'unregister old']);
    assert.equal(await store.get('u1'), 'new');
  });

  it('stops notifications once the person blocks them in the phone settings', async () => {
    const { deps, calls, store } = fake({ kind: 'denied' });
    await store.set('u1', 'old');
    assert.equal(await registerPush(deps, 'u1'), 'not_allowed');
    assert.deepEqual(calls, ['unregister old']);
    assert.equal(await store.get('u1'), null);
  });

  it('does nothing when notifications were never allowed', async () => {
    const { deps, calls } = fake({ kind: 'denied' });
    assert.equal(await registerPush(deps, 'u1'), 'not_allowed');
    assert.deepEqual(calls, []);
  });

  it('reports a phone that cannot get a token', async () => {
    const { deps, calls } = fake({ kind: 'unavailable', reason: 'not_a_phone' });
    assert.equal(await registerPush(deps, 'u1'), 'unavailable');
    assert.deepEqual(calls, []);
  });

  it('survives a token source that throws', async () => {
    const { deps } = fake({ kind: 'denied' });
    deps.source.getToken = async () => { throw new Error('boom'); };
    assert.equal(await registerPush(deps, 'u1'), 'unavailable');
  });
});

describe('unregisterPush', () => {
  it('takes the stored token back and forgets it', async () => {
    const { deps, calls, store } = fake({ kind: 'denied' });
    await store.set('u1', 't');
    await unregisterPush(deps, 'u1');
    assert.deepEqual(calls, ['unregister t']);
    assert.equal(await store.get('u1'), null);
  });

  it('does nothing without a stored token', async () => {
    const { deps, calls } = fake({ kind: 'denied' });
    await unregisterPush(deps, 'u1');
    assert.deepEqual(calls, []);
  });

  it('does not wait forever for a server that does not answer', async () => {
    const { deps, store } = fake({ kind: 'denied' }, { unregisterHangs: true });
    await store.set('u1', 't');
    const started = Date.now();
    await unregisterPush(deps, 'u1', 50);
    assert.ok(Date.now() - started < 1000);
    assert.equal(await store.get('u1'), null);
  });
});

const BASE = 'http://api.test';
describe('HttpPushTokenService', () => {
  it('sends PUT and DELETE /me/push-token with the token', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const tokens = new TokenStore(new MemorySessionStorage());
    await tokens.set({ accessToken: 'a', refreshToken: 'r' });
    const client = new ApiClient({
      baseUrl: BASE,
      tokens,
      fetch: (async (input: string, init: RequestInit = {}) => {
        calls.push({ url: String(input).replace(BASE, ''), method: init.method ?? 'GET', body: JSON.parse(String(init.body)) });
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch,
    });
    const service = new HttpPushTokenService(client);
    await service.register('T');
    await service.unregister('T');
    assert.deepEqual(calls, [
      { url: '/me/push-token', method: 'PUT', body: { token: 'T' } },
      { url: '/me/push-token', method: 'DELETE', body: { token: 'T' } },
    ]);
  });
});
