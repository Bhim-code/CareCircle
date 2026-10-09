import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeAuthError } from '../src/application/describeAuthError';
import { firstName, greetingFor } from '../src/application/greeting';
import { AuthError } from '../src/domain/errors/AuthError';
import { mapSupabaseError } from '../src/infrastructure/supabase/mapSupabaseError';
import { toAuthUser } from '../src/infrastructure/supabase/profileMapper';

describe('mapSupabaseError', () => {
  it('maps known provider codes to app error codes', () => {
    assert.equal(mapSupabaseError({ code: 'invalid_credentials' }).code, 'invalid_credentials');
    assert.equal(mapSupabaseError({ code: 'email_not_confirmed' }).code, 'email_not_confirmed');
    assert.equal(mapSupabaseError({ code: 'user_already_exists' }).code, 'email_taken');
    assert.equal(mapSupabaseError({ code: 'weak_password' }).code, 'weak_password');
    assert.equal(mapSupabaseError({ code: 'over_email_send_rate_limit' }).code, 'rate_limited');
  });

  it('recognises network failures', () => {
    assert.equal(mapSupabaseError({ name: 'AuthRetryableFetchError', message: 'x' }).code, 'network');
    assert.equal(mapSupabaseError({ status: 0, message: 'x' }).code, 'network');
  });

  it('falls back to unknown', () => {
    assert.equal(mapSupabaseError({ code: 'something_new' }).code, 'unknown');
  });
});

describe('toAuthUser', () => {
  it('builds a user from a profile row', () => {
    const user = toAuthUser({ id: '1', name: 'Ana', role: 'patient' }, 'ana@x.co');
    assert.deepEqual(user, { id: '1', email: 'ana@x.co', name: 'Ana', role: 'patient' });
  });

  it('refuses a missing or unknown role instead of guessing', () => {
    for (const role of [null, '', 'admin', 'super_admin']) {
      assert.throws(
        () => toAuthUser({ id: '1', name: 'A', role }, 'a@x.co'),
        (error: unknown) => error instanceof AuthError && error.code === 'profile_unavailable',
      );
    }
  });
});

describe('describeAuthError', () => {
  it('gives a plain-language message for AuthErrors and a safe one for anything else', () => {
    assert.match(describeAuthError(new AuthError('invalid_credentials')), /do not match/);
    assert.match(describeAuthError(new Error('boom')), /Something went wrong/);
    assert.match(describeAuthError('weird'), /Something went wrong/);
  });
});

describe('greeting', () => {
  it('greets by time of day', () => {
    assert.equal(greetingFor(new Date(2026, 0, 1, 8)), 'Good morning');
    assert.equal(greetingFor(new Date(2026, 0, 1, 14)), 'Good afternoon');
    assert.equal(greetingFor(new Date(2026, 0, 1, 20)), 'Good evening');
  });

  it('takes the first word of a name', () => {
    assert.equal(firstName('  Ana Maria Lopez '), 'Ana');
    assert.equal(firstName(''), '');
  });
});
