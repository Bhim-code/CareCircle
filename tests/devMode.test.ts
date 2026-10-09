import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuthUser } from '../src/domain/entities/AuthUser';
import { DevModeAuthService } from '../src/infrastructure/dev/DevModeAuthService';
import { DemoAuthService, DEMO_PASSWORD } from '../src/infrastructure/demo/DemoAuthService';

function setup() {
  const real = new DemoAuthService(0);
  const dev = new DevModeAuthService(real);
  const seen: (AuthUser | null)[] = [];
  dev.onAuthChange((user) => seen.push(user));
  return { real, dev, seen };
}

describe('DevModeAuthService (decorator)', () => {
  it('starts off, and passes sign-in through to the wrapped service', async () => {
    const { dev, seen } = setup();
    assert.equal(dev.isDevMode, false);
    assert.equal(await dev.getCurrentUser(), null);
    await dev.signIn('patient@demo.test', DEMO_PASSWORD);
    assert.equal(seen.at(-1)?.email, 'patient@demo.test');
  });

  it('enables dev mode as a patient by default, with no sign-in', async () => {
    const { dev, seen } = setup();
    dev.enableDevMode();
    assert.equal(dev.isDevMode, true);
    assert.equal((await dev.getCurrentUser())?.role, 'patient');
    assert.equal(seen.at(-1)?.role, 'patient');
  });

  it('switches role while active, and ignores a switch while inactive', async () => {
    const { dev } = setup();
    dev.switchDevRole('caregiver');
    assert.equal(dev.isDevMode, false);
    dev.enableDevMode('patient');
    dev.switchDevRole('caregiver');
    assert.equal((await dev.getCurrentUser())?.role, 'caregiver');
  });

  it('hides real sign-in changes while dev mode is on', async () => {
    const { real, dev, seen } = setup();
    dev.enableDevMode('caregiver');
    const before = seen.length;
    await real.signIn('patient@demo.test', DEMO_PASSWORD);
    assert.equal(seen.length, before);
    assert.equal((await dev.getCurrentUser())?.role, 'caregiver');
  });

  it('exiting dev mode returns to the real session', async () => {
    const { real, dev, seen } = setup();
    await real.signIn('patient@demo.test', DEMO_PASSWORD);
    dev.enableDevMode('caregiver');
    await dev.disableDevMode();
    assert.equal(dev.isDevMode, false);
    assert.equal(seen.at(-1)?.email, 'patient@demo.test');
  });

  it('exiting dev mode with no real session leaves the app signed out', async () => {
    const { dev, seen } = setup();
    dev.enableDevMode();
    await dev.disableDevMode();
    assert.equal(seen.at(-1), null);
  });

  it('sign-out leaves dev mode and signs out the real session too', async () => {
    const { real, dev, seen } = setup();
    await real.signIn('patient@demo.test', DEMO_PASSWORD);
    dev.enableDevMode('caregiver');
    await dev.signOut();
    assert.equal(dev.isDevMode, false);
    assert.equal(await real.getCurrentUser(), null);
    assert.equal(seen.at(-1), null);
  });
});
