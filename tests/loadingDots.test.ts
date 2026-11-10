import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CYCLE_MS,
  DOT_COLOR,
  DOT_COUNT,
  DOT_MAX_OPACITY,
  DOT_MAX_SCALE,
  DOT_MIN_OPACITY,
  DOT_MIN_SCALE,
  LOADING_LABEL,
  LOGO_ASPECT,
  LOGO_MAX_WIDTH,
  STAGGER_MS,
  logoWidth,
  runDots,
  stillLook,
  type MotionPreference,
} from '../src/application/loadingDots';

/** A phone whose "reduce motion" setting can be changed from the test. */
function fakePhone(initial: boolean | 'error') {
  let listener: ((on: boolean) => void) | null = null;
  const motion: MotionPreference = {
    isReduceMotionEnabled: () => (initial === 'error' ? Promise.reject(new Error('no answer')) : Promise.resolve(initial)),
    onChange: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
  };
  return { motion, change: (on: boolean) => listener?.(on), listening: () => listener !== null };
}

function fakeRunner() {
  const calls: string[] = [];
  return { runner: { start: () => calls.push('start'), stop: () => calls.push('stop') }, calls };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('the look of the dots', () => {
  it('has three dots that pulse for 1.2 seconds, 200 ms apart, in the logo green', () => {
    assert.equal(DOT_COUNT, 3);
    assert.equal(CYCLE_MS, 1200);
    assert.equal(STAGGER_MS, 200);
    assert.equal(DOT_COLOR, '#2E6A5C');
  });
  it('goes from 0.3 opacity and 0.8 scale up to 1 and 1.1', () => {
    assert.deepEqual([DOT_MIN_OPACITY, DOT_MAX_OPACITY, DOT_MIN_SCALE, DOT_MAX_SCALE], [0.3, 1, 0.8, 1.1]);
  });
  it('stays at 0.7 opacity and scale 1 when it does not move', () => {
    assert.deepEqual(stillLook(), { opacity: 0.7, scale: 1 });
  });
  it('says "Loading" to a screen reader', () => {
    assert.equal(LOADING_LABEL, 'Loading');
  });
});

describe('the logo size', () => {
  it('is 65% of the screen width, and never more than 280 points', () => {
    assert.equal(logoWidth(360), 360 * 0.65);
    assert.equal(logoWidth(1000), LOGO_MAX_WIDTH);
    assert.equal(LOGO_MAX_WIDTH, 280);
  });
  it('keeps the image shape', () => {
    assert.ok(Math.abs(LOGO_ASPECT - 900 / 121) < 1e-9);
  });
});

describe('runDots', () => {
  it('moves the dots when "reduce motion" is off', async () => {
    const { motion } = fakePhone(false);
    const { runner, calls } = fakeRunner();
    const stills: boolean[] = [];
    runDots(motion, runner, (s) => stills.push(s));
    await settle();
    assert.deepEqual(calls, ['start']);
    assert.deepEqual(stills, [false]);
  });

  it('does not start the animation when "reduce motion" is on', async () => {
    const { motion } = fakePhone(true);
    const { runner, calls } = fakeRunner();
    const stills: boolean[] = [];
    runDots(motion, runner, (s) => stills.push(s));
    await settle();
    assert.deepEqual(calls, []);
    assert.deepEqual(stills, [true]);
  });

  it('does not start before the phone has answered', () => {
    const { motion } = fakePhone(false);
    const { runner, calls } = fakeRunner();
    runDots(motion, runner, () => undefined);
    assert.deepEqual(calls, []);
  });

  it('stays still when the phone cannot say', async () => {
    const { motion } = fakePhone('error');
    const { runner, calls } = fakeRunner();
    runDots(motion, runner, () => undefined);
    await settle();
    assert.deepEqual(calls, []);
  });

  it('stops when "reduce motion" is switched on, and starts again when it is switched off', async () => {
    const phone = fakePhone(false);
    const { runner, calls } = fakeRunner();
    runDots(phone.motion, runner, () => undefined);
    await settle();
    phone.change(true);
    phone.change(false);
    assert.deepEqual(calls, ['start', 'stop', 'start']);
  });

  it('does not start twice when told the same thing twice', async () => {
    const phone = fakePhone(false);
    const { runner, calls } = fakeRunner();
    runDots(phone.motion, runner, () => undefined);
    await settle();
    phone.change(false);
    assert.deepEqual(calls, ['start']);
  });

  it('stops the animation and the listening when the screen goes away', async () => {
    const phone = fakePhone(false);
    const { runner, calls } = fakeRunner();
    const dispose = runDots(phone.motion, runner, () => undefined);
    await settle();
    dispose();
    assert.deepEqual(calls, ['start', 'stop']);
    assert.equal(phone.listening(), false);
  });

  it('never starts if the screen went away before the phone answered', async () => {
    const { motion } = fakePhone(false);
    const { runner, calls } = fakeRunner();
    const dispose = runDots(motion, runner, () => undefined);
    dispose();
    await settle();
    assert.deepEqual(calls, []);
  });
});
