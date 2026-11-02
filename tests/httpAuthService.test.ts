import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeAuthError } from '../src/application/describeAuthError';
import type { AuthUser } from '../src/domain/entities/AuthUser';
import { AuthError, type AuthErrorCode } from '../src/domain/errors/AuthError';
import { ApiClient } from '../src/infrastructure/http/ApiClient';
import { ApiError } from '../src/infrastructure/http/ApiError';
import { HttpAuthService } from '../src/infrastructure/http/HttpAuthService';
import { mapApiAuthError } from '../src/infrastructure/http/mapApiError';
import { TokenStore } from '../src/infrastructure/http/TokenStore';
import { MemorySessionStorage } from '../src/infrastructure/storage/MemorySessionStorage';

const BASE = 'https://api.test';

interface Seen {
  readonly path: string;
  readonly method: string;
  readonly auth: string | undefined;
  readonly body: Record<string, unknown> | undefined;
}

type Handler = (seen: Seen) => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function apiError(status: number, code: string, message: string, fields?: Record<string, string>): Response {
  return json(status, { error: { code, message, ...(fields ? { fields } : {}) } });
}

function sessionFor(role: string, extra: Record<string, unknown> = {}) {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresIn: 900,
    tokenType: 'Bearer',
    user: { id: 'u-1', email: 'ana@example.org', name: 'Ana', role, timezone: 'America/St_Johns', ...extra },
  };
}

function setup(handler: Handler, timeZone: () => string | undefined = () => 'America/St_Johns') {
  const seen: Seen[] = [];
  const storage = new MemorySessionStorage();
  const tokens = new TokenStore(storage);
  const fakeFetch = (async (input: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const entry: Seen = {
      path: String(input).replace(BASE, ''),
      method: init.method ?? 'GET',
      auth: headers.Authorization,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
    };
    seen.push(entry);
    return handler(entry);
  }) as unknown as typeof fetch;
  const api = new ApiClient({ baseUrl: BASE, tokens, fetch: fakeFetch });
  const service = new HttpAuthService(api, timeZone);
  const heard: Array<AuthUser | null> = [];
  service.onAuthChange((user) => heard.push(user));
  return { service, api, tokens, storage, seen, heard };
}

async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof AuthError, `expected an AuthError, got ${String(error)}`);
    return error;
  }
  assert.fail('expected the call to fail');
}

describe('HttpAuthService sign-in', () => {
  it('signs in, keeps the tokens and tells listeners who signed in', async () => {
    const { service, tokens, seen, heard } = setup(() => json(200, sessionFor('patient')));
    const user = await service.signIn('  Ana@Example.org ', 'demo1234');
    assert.deepEqual(user, { id: 'u-1', email: 'ana@example.org', name: 'Ana', role: 'patient' });
    assert.deepEqual(await tokens.get(), { accessToken: 'access-1', refreshToken: 'refresh-1' });
    assert.deepEqual(heard, [user]);
    assert.equal(seen[0].path, '/auth/sign-in');
    assert.equal(seen[0].auth, undefined, 'no token is sent before sign-in');
    assert.deepEqual(seen[0].body, { email: 'Ana@Example.org', password: 'demo1234' });
  });

  it('signs in a caregiver with the role the backend gave', async () => {
    const { service } = setup(() => json(200, sessionFor('caregiver')));
    assert.equal((await service.signIn('sam@example.org', 'demo1234')).role, 'caregiver');
  });

  it('says the email and password do not match, and keeps nothing', async () => {
    const { service, tokens, heard } = setup(() => apiError(401, 'unauthenticated', 'Email or password is incorrect.'));
    const error = await failure(service.signIn('ana@example.org', 'wrong'));
    assert.equal(error.code, 'invalid_credentials');
    assert.equal(await tokens.get(), null);
    assert.deepEqual(heard, []);
  });

  it('turns a missing connection into a network error', async () => {
    const { service } = setup(() => {
      throw new TypeError('Network request failed');
    });
    assert.equal((await failure(service.signIn('a@b.co', 'x'))).code, 'network');
  });

  it('turns too many attempts into rate_limited', async () => {
    const { service } = setup(() => apiError(429, 'too_many_requests', 'Too many requests.'));
    assert.equal((await failure(service.signIn('a@b.co', 'x'))).code, 'rate_limited');
  });

  it('turns a server fault into a general error', async () => {
    const { service } = setup(() => new Response('oops', { status: 500 }));
    assert.equal((await failure(service.signIn('a@b.co', 'x'))).code, 'unknown');
  });

  it('refuses admin and supervisor accounts, ends their session and keeps nothing', async () => {
    for (const role of ['admin', 'supervisor']) {
      const { service, tokens, seen, heard } = setup((s) =>
        s.path === '/auth/sign-in' ? json(200, sessionFor(role)) : new Response(null, { status: 204 }),
      );
      const error = await failure(service.signIn('sue@example.org', 'demo1234'));
      assert.equal(error.code, 'staff_account', role);
      assert.equal(await tokens.get(), null, role);
      assert.deepEqual(heard, [], role);
      assert.ok(seen.some((s) => s.path === '/auth/sign-out' && s.auth === 'Bearer access-1'), `${role}: session ended on the server`);
    }
  });

  it('refuses a role it does not know instead of guessing', async () => {
    const { service, tokens } = setup(() => json(200, sessionFor('wizard')));
    assert.equal((await failure(service.signIn('a@b.co', 'x'))).code, 'profile_unavailable');
    assert.equal(await tokens.get(), null);
  });

  it('refuses an answer with no user or no tokens', async () => {
    const noUser = setup(() => json(200, { accessToken: 'a', refreshToken: 'r' }));
    assert.equal((await failure(noUser.service.signIn('a@b.co', 'x'))).code, 'profile_unavailable');
    const noTokens = setup(() => json(200, { user: sessionFor('patient').user }));
    assert.equal((await failure(noTokens.service.signIn('a@b.co', 'x'))).code, 'unknown');
  });
});

describe('HttpAuthService sign-up', () => {
  it('signs the person up and in at once, sending role, name and time zone', async () => {
    const { service, tokens, seen, heard } = setup(() => json(201, sessionFor('caregiver', { name: 'Sam' })));
    const result = await service.signUp({ name: '  Sam ', email: ' sam@example.org ', password: 'longpassword', role: 'caregiver' });
    assert.equal(result.needsEmailConfirmation, false);
    assert.equal(result.user?.name, 'Sam');
    assert.deepEqual(heard, [result.user]);
    assert.notEqual(await tokens.get(), null);
    assert.deepEqual(seen[0].body, {
      name: 'Sam',
      email: 'sam@example.org',
      password: 'longpassword',
      role: 'caregiver',
      timezone: 'America/St_Johns',
    });
  });

  it('leaves the time zone out when the phone will not say', async () => {
    const { service, seen } = setup(() => json(201, sessionFor('patient')), () => undefined);
    await service.signUp({ name: 'Ana', email: 'ana@example.org', password: 'longpassword', role: 'patient' });
    assert.equal('timezone' in (seen[0].body ?? {}), false);
  });

  it('reports an email that is already used', async () => {
    const { service, tokens } = setup(() =>
      apiError(409, 'email_taken', 'An account with this email already exists.', { email: 'This email is already registered.' }),
    );
    const error = await failure(service.signUp({ name: 'A', email: 'a@b.co', password: 'longpassword', role: 'patient' }));
    assert.equal(error.code, 'email_taken');
    assert.equal(await tokens.get(), null);
  });

  it('reports an email the backend refuses and a password it finds weak', async () => {
    const badEmail = setup(() => apiError(422, 'invalid', 'Please check what you entered.', { email: 'not a valid email' }));
    assert.equal((await failure(badEmail.service.signUp({ name: 'A', email: 'x', password: 'longpassword', role: 'patient' }))).code, 'invalid_email');
    const weak = setup(() => apiError(422, 'invalid', 'Please check what you entered.', { password: 'Please use at least 8 characters.' }));
    assert.equal((await failure(weak.service.signUp({ name: 'A', email: 'a@b.co', password: 'short', role: 'patient' }))).code, 'weak_password');
  });
});

describe('HttpAuthService current user and sign-out', () => {
  it('is signed out, without calling the server, when nothing was saved', async () => {
    const { service, seen } = setup(() => json(200, {}));
    assert.equal(await service.getCurrentUser(), null);
    assert.equal(seen.length, 0);
  });

  it('knows who is signed in after the app restarts', async () => {
    const first = setup((s) => (s.path === '/auth/sign-in' ? json(200, sessionFor('patient')) : json(200, sessionFor('patient').user)));
    await first.service.signIn('ana@example.org', 'demo1234');

    // A "restart": a new client and service over the same saved tokens.
    const api = new ApiClient({
      baseUrl: BASE,
      tokens: new TokenStore(first.storage),
      fetch: (async () => json(200, sessionFor('patient').user)) as unknown as typeof fetch,
    });
    const user = await new HttpAuthService(api).getCurrentUser();
    assert.deepEqual(user, { id: 'u-1', email: 'ana@example.org', name: 'Ana', role: 'patient' });
  });

  it('is signed out when the saved sign-in can no longer be renewed, and tells listeners', async () => {
    const { service, tokens, heard } = setup((s) => apiError(401, 'unauthenticated', s.path === '/auth/refresh' ? 'No.' : 'Expired.'));
    await tokens.set({ accessToken: 'old', refreshToken: 'older' });
    assert.equal(await service.getCurrentUser(), null);
    assert.equal(await tokens.get(), null);
    assert.deepEqual(heard, [null]);
  });

  it('keeps the saved sign-in when the phone is offline at launch', async () => {
    const { service, tokens } = setup(() => {
      throw new TypeError('Network request failed');
    });
    await tokens.set({ accessToken: 'a', refreshToken: 'r' });
    assert.equal((await failure(service.getCurrentUser())).code, 'network');
    assert.deepEqual(await tokens.get(), { accessToken: 'a', refreshToken: 'r' });
  });

  it('signs out on the server and on the phone', async () => {
    const { service, tokens, seen, heard } = setup((s) => (s.path === '/auth/sign-out' ? new Response(null, { status: 204 }) : json(200, sessionFor('patient'))));
    await service.signIn('ana@example.org', 'demo1234');
    await service.signOut();
    assert.ok(seen.some((s) => s.path === '/auth/sign-out' && s.auth === 'Bearer access-1'));
    assert.equal(await tokens.get(), null);
    assert.equal(heard.at(-1), null);
  });

  it('signs out on the phone even when the server cannot be reached', async () => {
    let offline = false;
    const { service, tokens, heard } = setup(() => {
      if (offline) throw new TypeError('Network request failed');
      return json(200, sessionFor('patient'));
    });
    await service.signIn('ana@example.org', 'demo1234');
    offline = true;
    await service.signOut();
    assert.equal(await tokens.get(), null);
    assert.equal(heard.at(-1), null);
  });

  it('can sign out when nobody is signed in', async () => {
    const { service, seen, heard } = setup(() => json(200, {}));
    await service.signOut();
    assert.equal(seen.length, 0);
    assert.deepEqual(heard, [null]);
  });

  it('tells listeners when the backend ends the sign-in during normal use', async () => {
    let signedIn = false;
    const { service, api, heard } = setup((s) => {
      if (s.path === '/auth/sign-in') {
        signedIn = true;
        return json(200, sessionFor('patient'));
      }
      assert.ok(signedIn);
      return apiError(401, 'unauthenticated', s.path === '/auth/refresh' ? 'Reused.' : 'Expired.');
    });
    await service.signIn('ana@example.org', 'demo1234');
    await assert.rejects(api.get('/reminders'), (e: ApiError) => e.code === 'session_expired');
    assert.equal(heard.at(-1), null);
  });

  it('stops telling a listener after it unsubscribes', async () => {
    const { service } = setup(() => json(200, sessionFor('patient')));
    const heardLater: Array<AuthUser | null> = [];
    const stop = service.onAuthChange((u) => heardLater.push(u));
    stop();
    await service.signIn('ana@example.org', 'demo1234');
    assert.deepEqual(heardLater, []);
  });
});

describe('HttpAuthService password reset', () => {
  it('asks for a reset email without needing to be signed in', async () => {
    const { service, seen } = setup(() => new Response(null, { status: 204 }));
    await service.requestPasswordReset('  ana@example.org ');
    assert.equal(seen[0].path, '/auth/password-reset');
    assert.equal(seen[0].auth, undefined);
    assert.deepEqual(seen[0].body, { email: 'ana@example.org' });
  });

  it('reports too many requests', async () => {
    const { service } = setup(() => apiError(429, 'too_many_requests', 'Slow down.'));
    assert.equal((await failure(service.requestPasswordReset('a@b.co'))).code, 'rate_limited');
  });
});

describe('mapApiAuthError', () => {
  it('maps every backend answer the sign-in screens can meet', () => {
    const cases: Array<[ApiError | Error | AuthError, AuthErrorCode]> = [
      [new ApiError(0, 'network', 'x'), 'network'],
      [new ApiError(0, 'timeout', 'x'), 'network'],
      [new ApiError(409, 'email_taken', 'x'), 'email_taken'],
      [new ApiError(429, 'too_many_requests', 'x'), 'rate_limited'],
      [new ApiError(401, 'unauthenticated', 'x'), 'invalid_credentials'],
      [new ApiError(422, 'invalid', 'x', { fields: { email: 'bad' } }), 'invalid_email'],
      [new ApiError(422, 'invalid', 'x', { fields: { password: 'short' } }), 'weak_password'],
      [new ApiError(422, 'invalid', 'x', { fields: { newPassword: 'short' } }), 'weak_password'],
      [new ApiError(422, 'invalid', 'x', { fields: { name: 'required' } }), 'unknown'],
      [new ApiError(500, 'error', 'x'), 'unknown'],
      [new Error('boom'), 'unknown'],
      [new AuthError('staff_account'), 'staff_account'],
    ];
    for (const [input, expected] of cases) {
      assert.equal(mapApiAuthError(input).code, expected, `${input.name}: ${input.message}`);
    }
  });

  it('never leaks a technical message into the AuthError', () => {
    const mapped = mapApiAuthError(new Error('connect ECONNREFUSED 10.0.0.5:8000'));
    assert.doesNotMatch(mapped.message, /ECONNREFUSED|10\.0\.0\.5/);
  });
});

describe('describeAuthError for the new code', () => {
  it('explains that staff accounts belong on the admin page', () => {
    assert.match(describeAuthError(new AuthError('staff_account')), /admin page/i);
  });
});
