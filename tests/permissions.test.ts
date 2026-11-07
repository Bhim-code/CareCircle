import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkSession, hasPermission, samePermissions } from '../src/application/permissions';
import type { AuthUser } from '../src/domain/entities/AuthUser';
import { AuthError } from '../src/domain/errors/AuthError';
import type { IAuthService } from '../src/domain/services/IAuthService';

const base: AuthUser = { id: 'u-1', email: 'a@x.test', name: 'Ana', role: 'patient', permissions: ['tasks.view', 'documents.view'] };

/** A service that answers getCurrentUser however the test says. */
function service(answer: () => Promise<AuthUser | null>): IAuthService {
  return {
    getCurrentUser: answer,
    signUp: async () => ({ user: null, needsEmailConfirmation: false }),
    signIn: async () => base,
    signOut: async () => undefined,
    requestPasswordReset: async () => undefined,
    onAuthChange: () => () => undefined,
  };
}

describe('hasPermission and samePermissions', () => {
  it('allows only what the list holds, and nothing when there is no list', () => {
    assert.ok(hasPermission(['a', 'b'], 'b'));
    assert.equal(hasPermission(['a'], 'b'), false);
    assert.equal(hasPermission(undefined, 'a'), false);
    assert.equal(hasPermission([], 'a'), false);
  });
  it('compares lists whatever their order', () => {
    assert.ok(samePermissions(['a', 'b'], ['b', 'a']));
    assert.ok(samePermissions(undefined, []));
    assert.equal(samePermissions(['a'], ['a', 'b']), false);
    assert.equal(samePermissions(['a', 'b'], ['a', 'c']), false);
  });
});

describe('checkSession', () => {
  it('finds nothing new when nothing changed', async () => {
    const result = await checkSession(service(async () => ({ ...base, permissions: ['documents.view', 'tasks.view'] })), base);
    assert.equal(result.kind, 'same');
  });
  it('picks up a permission the supervisor gave', async () => {
    const result = await checkSession(service(async () => ({ ...base, permissions: [...base.permissions!, 'documents.upload'] })), base);
    assert.equal(result.kind, 'changed');
    assert.ok(result.kind === 'changed' && hasPermission(result.user.permissions, 'documents.upload'));
  });
  it('picks up a permission taken away', async () => {
    const result = await checkSession(service(async () => ({ ...base, permissions: ['tasks.view'] })), base);
    assert.ok(result.kind === 'changed' && !hasPermission(result.user.permissions, 'documents.view'));
  });
  it('picks up a changed name or role', async () => {
    assert.equal((await checkSession(service(async () => ({ ...base, name: 'Ana B' })), base)).kind, 'changed');
    assert.equal((await checkSession(service(async () => ({ ...base, role: 'pending' })), base)).kind, 'changed');
  });
  it('keeps the known permissions when the backend sends none this time', async () => {
    const { permissions: _gone, ...without } = base;
    assert.equal((await checkSession(service(async () => without), base)).kind, 'same');
    const renamed = await checkSession(service(async () => ({ ...without, name: 'Ana B' })), base);
    assert.ok(renamed.kind === 'changed' && renamed.user.name === 'Ana B' && hasPermission(renamed.user.permissions, 'tasks.view'));
  });
  it('says so when the sign-in has ended', async () => {
    assert.equal((await checkSession(service(async () => null), base)).kind, 'signedOut');
  });
  it('changes nothing when the phone is offline', async () => {
    const result = await checkSession(service(async () => { throw new AuthError('network'); }), base);
    assert.equal(result.kind, 'offline');
    const odd = await checkSession(service(async () => { throw new Error('boom'); }), base);
    assert.equal(odd.kind, 'offline');
  });
});
