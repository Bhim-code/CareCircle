import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AuthError } from '../src/domain/errors/AuthError';
import type { IAuthService } from '../src/domain/services/IAuthService';
import { DemoAuthService, DEMO_PASSWORD } from '../src/infrastructure/demo/DemoAuthService';

// Typed as the interface on purpose: this proves the demo service can stand in for the real one.
const make = (): IAuthService => new DemoAuthService(0);

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof AuthError && error.code === code);
}

describe('DemoAuthService (as IAuthService)', () => {
  it('starts signed out', async () => {
    assert.equal(await make().getCurrentUser(), null);
  });

  it('signs in the seeded patient and caregiver with the right roles', async () => {
    const service = make();
    const patient = await service.signIn('patient@demo.test', DEMO_PASSWORD);
    assert.equal(patient.role, 'patient');
    const caregiver = await service.signIn('CAREGIVER@demo.test ', DEMO_PASSWORD);
    assert.equal(caregiver.role, 'caregiver');
  });

  it('rejects a wrong password and an unknown email with the same error', async () => {
    const service = make();
    await rejectsWith(service.signIn('patient@demo.test', 'nope'), 'invalid_credentials');
    await rejectsWith(service.signIn('nobody@demo.test', DEMO_PASSWORD), 'invalid_credentials');
  });

  it('signs a new person up, signs them in, and keeps their chosen role', async () => {
    const service = make();
    const result = await service.signUp({ name: 'Lee', email: 'lee@x.co', password: 'password1', role: 'caregiver' });
    assert.equal(result.needsEmailConfirmation, false);
    assert.equal(result.user?.role, 'caregiver');
    assert.equal((await service.getCurrentUser())?.email, 'lee@x.co');
  });

  it('refuses a second sign-up with the same email', async () => {
    const service = make();
    await rejectsWith(
      service.signUp({ name: 'Dup', email: 'PATIENT@demo.test', password: 'password1', role: 'patient' }),
      'email_taken',
    );
  });

  it('notifies listeners on sign-in and sign-out, and stops after unsubscribe', async () => {
    const service = make();
    const seen: (string | null)[] = [];
    const unsubscribe = service.onAuthChange((user) => seen.push(user?.email ?? null));
    await service.signIn('patient@demo.test', DEMO_PASSWORD);
    await service.signOut();
    unsubscribe();
    await service.signIn('patient@demo.test', DEMO_PASSWORD);
    assert.deepEqual(seen, ['patient@demo.test', null]);
  });
});
