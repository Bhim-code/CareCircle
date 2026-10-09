import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  validateConfirmation,
  validateEmail,
  validatePassword,
  validateSignIn,
  validateSignUp,
} from '../src/application/validation/authValidators';

describe('validators', () => {
  it('accepts normal emails and rejects malformed ones', () => {
    assert.equal(validateEmail('ana@example.com'), undefined);
    assert.equal(validateEmail('  ana@example.com  '), undefined);
    assert.ok(validateEmail(''));
    assert.ok(validateEmail('ana'));
    assert.ok(validateEmail('ana@'));
    assert.ok(validateEmail('ana@example'));
  });

  it('requires passwords of at least 8 characters', () => {
    assert.ok(validatePassword(''));
    assert.ok(validatePassword('1234567'));
    assert.equal(validatePassword('12345678'), undefined);
  });

  it('checks the confirmation matches', () => {
    assert.ok(validateConfirmation('abcdefgh', ''));
    assert.ok(validateConfirmation('abcdefgh', 'abcdefgX'));
    assert.equal(validateConfirmation('abcdefgh', 'abcdefgh'), undefined);
  });

  it('sign-in only requires that a password was typed', () => {
    assert.deepEqual(validateSignIn({ email: 'a@b.co', password: 'x' }), {});
    assert.ok(validateSignIn({ email: 'a@b.co', password: '' }).password);
  });

  it('sign-up reports every problem at once', () => {
    const errors = validateSignUp({ role: '', name: '', email: 'x', password: 'short', confirmation: '' });
    assert.deepEqual(Object.keys(errors).sort(), ['confirmation', 'email', 'name', 'password', 'role']);
  });

  it('sign-up rejects an unknown role, so nobody can pick "admin"', () => {
    const errors = validateSignUp({
      role: 'admin', name: 'Ana', email: 'a@b.co', password: 'password1', confirmation: 'password1',
    });
    assert.ok(errors.role);
  });

  it('sign-up passes with valid input', () => {
    assert.deepEqual(
      validateSignUp({ role: 'caregiver', name: 'Sam', email: 'sam@b.co', password: 'password1', confirmation: 'password1' }),
      {},
    );
  });
});
