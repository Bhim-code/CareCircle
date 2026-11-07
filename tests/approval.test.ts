import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACCOUNT_UPDATED_NOTICE, APPROVAL_CHECK_INTERVAL_MS, checkApproval } from '../src/application/approval';
import { isApproved, type AuthUser } from '../src/domain/entities/AuthUser';
import { AuthError } from '../src/domain/errors/AuthError';
import type { IAuthService } from '../src/domain/services/IAuthService';

const waiting: AuthUser = { id: 'u-1', email: 'ana@example.org', name: 'Ana', role: 'pending' };
const approved: AuthUser = { ...waiting, role: 'patient' };

/** A service that answers getCurrentUser as told. The other methods are never used here. */
function serviceThat(answer: () => Promise<AuthUser | null>): IAuthService {
  return {
    getCurrentUser: answer,
    signUp: async () => { throw new Error('not used'); },
    signIn: async () => { throw new Error('not used'); },
    signOut: async () => {},
    requestPasswordReset: async () => {},
    onAuthChange: () => () => {},
  };
}

describe('isApproved', () => {
  it('is false only for a waiting account', () => {
    assert.equal(isApproved(waiting), false);
    assert.equal(isApproved(approved), true);
    assert.equal(isApproved({ ...waiting, role: 'caregiver' }), true);
  });
});

describe('checkApproval', () => {
  it('says the person is still waiting', async () => {
    const result = await checkApproval(serviceThat(async () => waiting));
    assert.deepEqual(result, { kind: 'pending', user: waiting });
  });

  it('says the account was approved when a role shows up', async () => {
    const result = await checkApproval(serviceThat(async () => approved));
    assert.deepEqual(result, { kind: 'approved', user: approved });
  });

  it('says the sign-in ended, which is what the backend does when a role is given', async () => {
    const result = await checkApproval(serviceThat(async () => null));
    assert.deepEqual(result, { kind: 'signedOut' });
  });

  it('says there is no connection instead of failing', async () => {
    const result = await checkApproval(serviceThat(async () => { throw new AuthError('network'); }));
    assert.equal(result.kind, 'offline');
    if (result.kind === 'offline') assert.match(result.message, /connect|internet|network/i);
  });

  it('never throws, even for an error it does not know', async () => {
    const result = await checkApproval(serviceThat(async () => { throw new Error('boom'); }));
    assert.equal(result.kind, 'offline');
  });
});

describe('waiting-screen settings', () => {
  it('checks about once a minute and has a clear notice for the sign-in screen', () => {
    assert.equal(APPROVAL_CHECK_INTERVAL_MS, 60_000);
    assert.match(ACCOUNT_UPDATED_NOTICE, /sign in again/i);
  });
});
