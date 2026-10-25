import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LARGER_TEXT_SCALE,
  normalizePreferences,
  parsePreferences,
  preferencesKey,
  textScaleFor,
} from '../src/application/preferences';
import { DEFAULT_PREFERENCES } from '../src/domain/entities/UserPreferences';
import { MemoryPreferencesStore } from '../src/infrastructure/storage/MemoryPreferencesStore';

describe('normalizePreferences', () => {
  it('returns the defaults for anything that is not an object', () => {
    for (const bad of [null, undefined, 'x', 42, true]) {
      assert.deepEqual(normalizePreferences(bad), DEFAULT_PREFERENCES);
    }
  });

  it('keeps valid booleans and replaces wrongly typed fields with defaults', () => {
    const result = normalizePreferences({ largerText: true, missedDoseCall: 'yes', extra: 1 });
    assert.equal(result.largerText, true);
    assert.equal(result.missedDoseCall, DEFAULT_PREFERENCES.missedDoseCall);
    assert.equal('extra' in result, false);
  });

  it('fills in settings that older saved data does not have', () => {
    const result = normalizePreferences({ largerText: true });
    assert.equal(result.reminderNotifications, DEFAULT_PREFERENCES.reminderNotifications);
  });
});

describe('parsePreferences', () => {
  it('uses the defaults when nothing is stored or the data is damaged', () => {
    assert.deepEqual(parsePreferences(null), DEFAULT_PREFERENCES);
    assert.deepEqual(parsePreferences('{not json'), DEFAULT_PREFERENCES);
  });

  it('reads stored settings', () => {
    const stored = JSON.stringify({ ...DEFAULT_PREFERENCES, largerText: true });
    assert.equal(parsePreferences(stored).largerText, true);
  });
});

describe('text scale and keys', () => {
  it('scales text only when larger text is on', () => {
    assert.equal(textScaleFor(DEFAULT_PREFERENCES), 1);
    assert.equal(textScaleFor({ ...DEFAULT_PREFERENCES, largerText: true }), LARGER_TEXT_SCALE);
  });

  it('gives each person their own storage key', () => {
    assert.notEqual(preferencesKey('a'), preferencesKey('b'));
  });
});

describe('MemoryPreferencesStore', () => {
  it('returns defaults for a new person and remembers saved settings', async () => {
    const store = new MemoryPreferencesStore();
    assert.deepEqual(await store.load('u1'), DEFAULT_PREFERENCES);
    await store.save('u1', { ...DEFAULT_PREFERENCES, largerText: true });
    assert.equal((await store.load('u1')).largerText, true);
  });

  it('never shows one person the settings of another', async () => {
    const store = new MemoryPreferencesStore();
    await store.save('u1', { ...DEFAULT_PREFERENCES, largerText: true });
    assert.equal((await store.load('u2')).largerText, false);
  });
});

describe('alarm settings', () => {
  it('start with sound, vibration and a 10 minute snooze', () => {
    assert.equal(DEFAULT_PREFERENCES.alarmSound, true);
    assert.equal(DEFAULT_PREFERENCES.alarmVibration, true);
    assert.equal(DEFAULT_PREFERENCES.snoozeMinutes, 10);
  });

  it('keep a valid snooze length and reject any other number', () => {
    assert.equal(normalizePreferences({ snoozeMinutes: 15 }).snoozeMinutes, 15);
    assert.equal(normalizePreferences({ snoozeMinutes: 7 }).snoozeMinutes, 10);
    assert.equal(normalizePreferences({ snoozeMinutes: '5' }).snoozeMinutes, 10);
    assert.equal(normalizePreferences({ snoozeMinutes: -1 }).snoozeMinutes, 10);
  });

  it('load settings saved before alarms existed', () => {
    const old = { largerText: true, reminderNotifications: false, missedDoseEmail: true, missedDoseCall: false };
    const result = normalizePreferences(old);
    assert.equal(result.largerText, true);
    assert.equal(result.reminderNotifications, false);
    assert.equal(result.alarmSound, true);
    assert.equal(result.snoozeMinutes, 10);
  });
});
