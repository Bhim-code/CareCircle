import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiClient } from '../src/infrastructure/http/ApiClient';
import { ApiError } from '../src/infrastructure/http/ApiError';
import { TOKEN_STORAGE_KEY, TokenStore } from '../src/infrastructure/http/TokenStore';
import { MemorySessionStorage } from '../src/infrastructure/storage/MemorySessionStorage';

const BASE = 'https://api.test';

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

type Handler = (call: Call) => Response | Promise<Response>;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function apiError(status: number, code: string, message: string, fields?: Record<string, string>) {
  return json(status, { error: { code, message, ...(fields ? { fields } : {}) } });
}

/** A fake backend: records every call and answers with whatever the handler returns. */
function makeClient(
  handler: Handler,
  options: { tokens?: { accessToken: string; refreshToken: string } | null; timeoutMs?: number } = {},
) {
  const calls: Call[] = [];
  const storage = new MemorySessionStorage();
  const tokens = new TokenStore(storage);
  const expired: string[] = [];

  const fakeFetch = (async (input: string, init: RequestInit = {}) => {
    const call: Call = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    };
    calls.push(call);
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return handler(call);
  }) as unknown as typeof fetch;

  const client = new ApiClient({
    baseUrl: BASE,
    tokens,
    fetch: fakeFetch,
    timeoutMs: options.timeoutMs,
    onSessionExpired: () => expired.push('expired'),
  });

  const ready =
    options.tokens === null
      ? Promise.resolve()
      : tokens.set(options.tokens ?? { accessToken: 'access-1', refreshToken: 'refresh-1' });

  return { client, calls, tokens, storage, expired, ready };
}

describe('ApiClient requests', () => {
  it('sends the access token and reads the JSON answer', async () => {
    const { client, calls, ready } = makeClient(() => json(200, { id: 'r1' }));
    await ready;
    const result = await client.get<{ id: string }>('/reminders');
    assert.deepEqual(result, { id: 'r1' });
    assert.equal(calls[0].url, `${BASE}/reminders`);
    assert.equal(calls[0].headers.Authorization, 'Bearer access-1');
  });

  it('writes the query, leaving out empty values and escaping the rest', async () => {
    const { client, calls, ready } = makeClient(() => json(200, []));
    await ready;
    await client.get('/reminders', {
      query: { day: '2026-10-29', timezone: 'America/St_Johns', kind: undefined, patientId: null, n: 2 },
    });
    assert.equal(calls[0].url, `${BASE}/reminders?day=2026-10-29&timezone=America%2FSt_Johns&n=2`);
  });

  it('copes with a slash at the end of the address or the start of the path', async () => {
    const calls: Call[] = [];
    const tokens = new TokenStore(new MemorySessionStorage());
    await tokens.set({ accessToken: 'a', refreshToken: 'r' });
    const client = new ApiClient({
      baseUrl: `${BASE}//`,
      tokens,
      fetch: (async (input: string, init: RequestInit = {}) => {
        calls.push({ url: String(input), method: init.method ?? 'GET', headers: {}, body: undefined });
        return json(200, {});
      }) as unknown as typeof fetch,
    });
    await client.get('medicines');
    await client.get('/medicines');
    assert.equal(calls[0].url, `${BASE}/medicines`);
    assert.equal(calls[1].url, `${BASE}/medicines`);
  });

  it('sends a body as JSON', async () => {
    const { client, calls, ready } = makeClient(() => json(201, { id: 'm1' }));
    await ready;
    await client.post('/medicines', { name: 'Metformin' });
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers['Content-Type'], 'application/json');
    assert.deepEqual(calls[0].body, { name: 'Metformin' });
  });

  it('sends a file upload as it is, without a JSON content type', async () => {
    const { client, calls, ready } = makeClient(() => json(201, { photoUri: 'x' }));
    await ready;
    const form = new FormData();
    form.append('file', new Blob(['hello']), 'a.jpg');
    await client.post('/entries/photo', form);
    assert.equal(calls[0].body, form);
    assert.equal(calls[0].headers['Content-Type'], undefined);
  });

  it('returns nothing for 204 answers', async () => {
    const { client, ready } = makeClient(() => new Response(null, { status: 204 }));
    await ready;
    assert.equal(await client.post('/reminders/r1/acknowledge'), undefined);
  });

  it('sends no token for calls made before sign-in', async () => {
    const { client, calls } = makeClient(() => json(200, { accessToken: 'a', refreshToken: 'r' }), {
      tokens: null,
    });
    await client.post('/auth/sign-in', { email: 'a@b.c', password: 'x' }, { auth: false });
    assert.equal(calls[0].headers.Authorization, undefined);
  });

  it('refuses a call that needs sign-in when there is no sign-in, without calling the server', async () => {
    const { client, calls } = makeClient(() => json(200, {}), { tokens: null });
    await assert.rejects(client.get('/reminders'), (e: ApiError) => {
      assert.equal(e.status, 401);
      assert.equal(e.code, 'unauthenticated');
      return true;
    });
    assert.equal(calls.length, 0);
  });
});

describe('ApiClient errors', () => {
  it('uses the code, message and fields the backend sent', async () => {
    const { client, ready } = makeClient(() =>
      apiError(409, 'email_taken', 'An account with this email already exists.', {
        email: 'This email is already registered.',
      }),
    );
    await ready;
    await assert.rejects(client.post('/x', {}, { auth: false }), (e: ApiError) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.status, 409);
      assert.equal(e.code, 'email_taken');
      assert.equal(e.message, 'An account with this email already exists.');
      assert.deepEqual(e.fields, { email: 'This email is already registered.' });
      return true;
    });
  });

  it('makes up a code and message when the answer is not in the backend shape', async () => {
    const { client, ready } = makeClient(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    await ready;
    await assert.rejects(client.get('/x'), (e: ApiError) => {
      assert.equal(e.status, 502);
      assert.equal(e.code, 'error');
      assert.match(e.message, /server had a problem/i);
      assert.doesNotMatch(e.message, /html|gateway/i);
      return true;
    });
  });

  it('knows the code for common statuses even with an empty body', async () => {
    const { client, ready } = makeClient(() => new Response(null, { status: 404 }));
    await ready;
    await assert.rejects(client.get('/x'), (e: ApiError) => e.code === 'not_found');
  });

  it('passes on how long to wait after a 429', async () => {
    const { client, ready } = makeClient(() =>
      json(429, { error: { code: 'too_many_requests', message: 'Slow down.' } }, { 'Retry-After': '42' }),
    );
    await ready;
    await assert.rejects(client.get('/x'), (e: ApiError) => {
      assert.equal(e.code, 'too_many_requests');
      assert.equal(e.retryAfterSeconds, 42);
      return true;
    });
  });

  it('says so when the phone cannot reach the server', async () => {
    const { client, ready } = makeClient(() => {
      throw new TypeError('Network request failed');
    });
    await ready;
    await assert.rejects(client.get('/x'), (e: ApiError) => {
      assert.equal(e.status, 0);
      assert.equal(e.code, 'network');
      assert.equal(e.isConnectionProblem, true);
      assert.doesNotMatch(e.message, /TypeError|Network request failed/);
      return true;
    });
  });

  it('gives up with a timeout error when the server never answers', async () => {
    // Like the real fetch, this one rejects when it is aborted and otherwise never answers.
    const slow = new ApiClient({
      baseUrl: BASE,
      tokens: new TokenStore(new MemorySessionStorage()),
      timeoutMs: 20,
      fetch: ((_: string, init: RequestInit = {}) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })) as unknown as typeof fetch,
    });
    await assert.rejects(slow.get('/x', { auth: false }), (e: ApiError) => {
      assert.equal(e.status, 0);
      assert.equal(e.code, 'timeout');
      return true;
    });
  });

  it('lets a cancel from the caller through unchanged', async () => {
    const controller = new AbortController();
    const client = new ApiClient({
      baseUrl: BASE,
      tokens: new TokenStore(new MemorySessionStorage()),
      fetch: ((_: string, init: RequestInit = {}) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })) as unknown as typeof fetch,
    });
    const pending = client.get('/x', { auth: false, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (e: unknown) => {
      assert.ok(!(e instanceof ApiError));
      assert.equal((e as Error).name, 'AbortError');
      return true;
    });
  });

  it('reports an answer it cannot read as bad_response', async () => {
    const { client, ready } = makeClient(() => new Response('not json', { status: 200 }));
    await ready;
    await assert.rejects(client.get('/x'), (e: ApiError) => e.code === 'bad_response');
  });
});

describe('ApiClient token renewal', () => {
  /** Accepts only the newest access token; /auth/refresh swaps both tokens. */
  function renewingServer() {
    const state = { access: 'access-2', refresh: 'refresh-2', refreshCalls: 0, refreshTokensSeen: [] as string[] };
    const handler: Handler = async (call) => {
      if (call.url.endsWith('/auth/refresh')) {
        state.refreshCalls += 1;
        const sent = (call.body as { refreshToken: string }).refreshToken;
        state.refreshTokensSeen.push(sent);
        // Single use: the second use of the same refresh token is refused.
        if (sent !== 'refresh-1' || state.refreshCalls > 1) {
          return apiError(401, 'unauthenticated', 'Please sign in.');
        }
        await new Promise((r) => setTimeout(r, 15));
        return json(200, { accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 900, tokenType: 'Bearer' });
      }
      if (call.headers.Authorization === `Bearer ${state.access}`) return json(200, { ok: true });
      return apiError(401, 'unauthenticated', 'Please sign in.');
    };
    return { state, handler };
  }

  it('renews once and repeats the call that was refused', async () => {
    const { handler } = renewingServer();
    const { client, calls, tokens, ready } = makeClient(handler);
    await ready;
    const result = await client.get<{ ok: boolean }>('/reminders');
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.url.replace(BASE, '')} ${c.headers.Authorization ?? '-'}`),
      [
        'GET /reminders Bearer access-1',
        'POST /auth/refresh -',
        'GET /reminders Bearer access-2',
      ],
    );
    assert.deepEqual(await tokens.get(), { accessToken: 'access-2', refreshToken: 'refresh-2' });
  });

  it('saves the NEW refresh token, also to storage', async () => {
    const { handler } = renewingServer();
    const { client, storage, ready } = makeClient(handler);
    await ready;
    await client.get('/reminders');
    const saved = JSON.parse((await storage.getItem(TOKEN_STORAGE_KEY)) as string);
    assert.deepEqual(saved, { accessToken: 'access-2', refreshToken: 'refresh-2' });
  });

  it('sends ONE renewal when several calls are refused at the same time', async () => {
    const { state, handler } = renewingServer();
    const { client, ready } = makeClient(handler);
    await ready;
    const results = await Promise.all([
      client.get('/reminders'),
      client.get('/medicines'),
      client.get('/entries'),
      client.get('/care-links'),
    ]);
    assert.equal(results.length, 4);
    assert.equal(state.refreshCalls, 1);
  });

  it('reuses a renewal that finished while a slow call was still on its way', async () => {
    const { state, handler } = renewingServer();
    const { client, tokens, ready } = makeClient(handler);
    await ready;
    // Simulates: a call sent with access-1 is refused AFTER another call already renewed.
    await client.get('/reminders'); // renews to access-2
    const refreshCallsBefore = state.refreshCalls;
    // Pretend the stored tokens are the new ones, but this call is refused for its old token.
    const stale = new ApiClient({
      baseUrl: BASE,
      tokens,
      fetch: (async (_: string, init: RequestInit = {}) => {
        const auth = (init.headers as Record<string, string>).Authorization;
        return auth === 'Bearer access-2' ? json(200, { ok: true }) : apiError(401, 'unauthenticated', 'Please sign in.');
      }) as unknown as typeof fetch,
    });
    // Force the first attempt to use the old token by clearing the cache path: set old, then new.
    await tokens.set({ accessToken: 'access-1', refreshToken: 'refresh-x' });
    const pending = stale.get('/reminders');
    await tokens.set({ accessToken: 'access-2', refreshToken: 'refresh-2' });
    assert.deepEqual(await pending, { ok: true });
    assert.equal(state.refreshCalls, refreshCallsBefore);
  });

  it('ends the sign-in, clears the tokens and tells the app when the renewal is refused', async () => {
    const { client, tokens, expired, ready } = makeClient((call) =>
      apiError(401, 'unauthenticated', call.url.endsWith('/auth/refresh') ? 'Please sign in.' : 'Token expired.'),
    );
    await ready;
    await assert.rejects(client.get('/reminders'), (e: ApiError) => {
      assert.equal(e.code, 'session_expired');
      assert.equal(e.status, 401);
      return true;
    });
    assert.equal(await tokens.get(), null);
    assert.deepEqual(expired, ['expired']);
  });

  it('tells the app only once when several calls fail together', async () => {
    const { client, expired, ready } = makeClient((call) =>
      apiError(401, 'unauthenticated', call.url.endsWith('/auth/refresh') ? 'No.' : 'Expired.'),
    );
    await ready;
    const outcomes = await Promise.allSettled([client.get('/a'), client.get('/b'), client.get('/c')]);
    assert.ok(outcomes.every((o) => o.status === 'rejected'));
    assert.deepEqual(expired, ['expired']);
  });

  it('keeps the sign-in when the renewal fails only because there is no connection', async () => {
    const { client, tokens, expired, ready } = makeClient((call) => {
      if (call.url.endsWith('/auth/refresh')) throw new TypeError('Network request failed');
      return apiError(401, 'unauthenticated', 'Expired.');
    });
    await ready;
    await assert.rejects(client.get('/reminders'), (e: ApiError) => e.code === 'network');
    assert.deepEqual(await tokens.get(), { accessToken: 'access-1', refreshToken: 'refresh-1' });
    assert.deepEqual(expired, []);
  });

  it('keeps the sign-in when the renewal fails with a server fault', async () => {
    const { client, tokens, expired, ready } = makeClient((call) =>
      call.url.endsWith('/auth/refresh') ? new Response(null, { status: 503 }) : apiError(401, 'unauthenticated', 'Expired.'),
    );
    await ready;
    await assert.rejects(client.get('/reminders'), (e: ApiError) => e.status === 503);
    assert.notEqual(await tokens.get(), null);
    assert.deepEqual(expired, []);
  });

  it('does not loop when the repeated call is refused too', async () => {
    let refreshes = 0;
    const { client, calls, ready } = makeClient((call) => {
      if (call.url.endsWith('/auth/refresh')) {
        refreshes += 1;
        return json(200, { accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 900 });
      }
      return apiError(401, 'unauthenticated', 'Not allowed.');
    });
    await ready;
    await assert.rejects(client.get('/reminders'), (e: ApiError) => e.status === 401 && e.code === 'unauthenticated');
    assert.equal(refreshes, 1);
    assert.equal(calls.length, 3);
  });

  it('does not try to renew for calls made before sign-in, such as a wrong password', async () => {
    const { client, calls, expired } = makeClient(() => apiError(401, 'unauthenticated', 'Email or password is incorrect.'), {
      tokens: null,
    });
    await assert.rejects(
      client.post('/auth/sign-in', { email: 'a@b.c', password: 'bad' }, { auth: false }),
      (e: ApiError) => e.message === 'Email or password is incorrect.',
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(expired, []);
  });

  it('does not renew for errors other than 401', async () => {
    const { client, calls, ready } = makeClient(() => apiError(403, 'forbidden', 'You are not allowed to do this.'));
    await ready;
    await assert.rejects(client.get('/admin'), (e: ApiError) => e.status === 403);
    assert.equal(calls.length, 1);
  });

  it('refuses a renewal answer that is missing a token', async () => {
    const { client, tokens, ready } = makeClient((call) =>
      call.url.endsWith('/auth/refresh') ? json(200, { accessToken: 'only-access' }) : apiError(401, 'unauthenticated', 'Expired.'),
    );
    await ready;
    await assert.rejects(client.get('/reminders'), (e: ApiError) => e.code === 'bad_response');
    assert.deepEqual(await tokens.get(), { accessToken: 'access-1', refreshToken: 'refresh-1' });
  });
});

describe('TokenStore', () => {
  it('remembers tokens between launches', async () => {
    const storage = new MemorySessionStorage();
    await new TokenStore(storage).set({ accessToken: 'a', refreshToken: 'r' });
    assert.deepEqual(await new TokenStore(storage).get(), { accessToken: 'a', refreshToken: 'r' });
  });

  it('treats damaged saved data as signed out', async () => {
    for (const junk of ['not json', '{}', '{"accessToken":"a"}', '{"accessToken":"","refreshToken":""}', '[1]', 'null']) {
      const storage = new MemorySessionStorage();
      await storage.setItem(TOKEN_STORAGE_KEY, junk);
      assert.equal(await new TokenStore(storage).get(), null, junk);
    }
  });

  it('forgets everything on clear, including what is saved', async () => {
    const storage = new MemorySessionStorage();
    const store = new TokenStore(storage);
    await store.set({ accessToken: 'a', refreshToken: 'r' });
    await store.clear();
    assert.equal(await store.get(), null);
    assert.equal(await storage.getItem(TOKEN_STORAGE_KEY), null);
  });
});
