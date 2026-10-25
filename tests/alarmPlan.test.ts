import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_ALARM,
  MAX_PLANNED_RINGS,
  missedAfterMinutes,
  planRings,
  planSnooze,
  ringText,
} from '../src/application/alarmPlan';
import { isTestReminder, TEST_REMINDER_PREFIX } from '../src/application/alarmActions';
import type { Reminder } from '../src/domain/entities/Reminder';

// Monday 12 October 2026, local time.
const at = (hour: number, minute = 0, day = 12) => new Date(2026, 9, day, hour, minute);

function dose(id: string, time: Date, extra: Partial<Reminder> = {}): Reminder {
  return { id, medicineName: `Medicine ${id}`, scheduledAt: time.toISOString(), acknowledged: false, ...extra };
}

describe('planRings', () => {
  it('plans one alarm per dose, at the dose time, ringing for 2 minutes', () => {
    const rings = planRings([dose('a', at(13))], at(9));
    assert.equal(rings.length, 1);
    assert.equal(rings[0].fireAt.getTime(), at(13).getTime());
    assert.equal(rings[0].ringSeconds, 120);
    assert.equal(rings[0].snoozed, false);
  });

  it('gives the alarm the same id every time, so scheduling it again replaces it', () => {
    const first = planRings([dose('a', at(13))], at(9));
    const again = planRings([dose('a', at(13))], at(9));
    assert.equal(first[0].id, again[0].id);
  });

  it('plans nothing for a dose that was taken', () => {
    assert.deepEqual(planRings([dose('a', at(13), { acknowledged: true })], at(9)), []);
  });

  it('plans nothing for a dose that was skipped', () => {
    assert.deepEqual(planRings([dose('a', at(13), { skipped: true })], at(9)), []);
  });

  it('drops a dose whose time has already passed', () => {
    assert.deepEqual(planRings([dose('a', at(13))], at(13, 1)), []);
  });

  it('puts the alarms of several doses in time order', () => {
    const rings = planRings([dose('late', at(21)), dose('early', at(8))], at(7));
    assert.deepEqual(rings.map((ring) => ring.reminderId), ['early', 'late']);
  });

  it('plans tomorrow morning tonight, but not days ahead', () => {
    const rings = planRings([dose('t', at(8, 0, 13)), dose('far', at(8, 0, 15))], at(21));
    assert.deepEqual(rings.map((ring) => ring.reminderId), ['t']);
  });

  it('never plans more than the phone can hold', () => {
    const many = Array.from({ length: 70 }, (_, index) =>
      dose(`d${index}`, at(10), { scheduledAt: new Date(2026, 9, 12, 10, index).toISOString() }),
    );
    assert.equal(planRings(many, at(9)).length, MAX_PLANNED_RINGS);
  });

  it('follows a different ring length', () => {
    const rings = planRings([dose('a', at(13))], at(9), { ...DEFAULT_ALARM, ringMinutes: 5 });
    assert.equal(rings[0].ringSeconds, 300);
  });
});

describe('planSnooze', () => {
  it('rings once, after the snooze time', () => {
    const alarm = planSnooze('a', 'Metformin', at(13, 2));
    assert.equal(alarm.fireAt.getTime(), at(13, 12).getTime());
    assert.equal(alarm.snoozed, true);
    assert.ok(alarm.id.startsWith('snooze:a'));
  });

  it('uses the snooze length the person chose', () => {
    const alarm = planSnooze('a', 'Metformin', at(13, 0), { ...DEFAULT_ALARM, snoozeMinutes: 15 });
    assert.equal(alarm.fireAt.getTime(), at(13, 15).getTime());
  });

  it('never shares an id with a normal alarm', () => {
    const [normal] = planRings([dose('a', at(13))], at(9));
    assert.notEqual(normal.id, planSnooze('a', 'x', at(13)).id);
  });
});

describe('missedAfterMinutes', () => {
  it('is the ring time plus a few minutes to react', () => {
    assert.equal(missedAfterMinutes(), 5);
    assert.equal(missedAfterMinutes({ ...DEFAULT_ALARM, ringMinutes: 5 }), 8);
  });
});

describe('ringText', () => {
  it('names the medicine, and says "Reminder" after a snooze', () => {
    const first = ringText({ medicineName: 'Metformin', snoozed: false });
    const again = ringText({ medicineName: 'Metformin', snoozed: true });
    assert.match(first.body, /Metformin/);
    assert.doesNotMatch(first.title, /Reminder/);
    assert.match(again.title, /Reminder/);
  });
});

describe('test alarms', () => {
  it('are recognised so they are never saved as real doses', () => {
    assert.equal(isTestReminder(`${TEST_REMINDER_PREFIX}123`), true);
    assert.equal(isTestReminder('2026-10-12-1'), false);
  });
});

import { remainingRingSeconds } from '../src/application/alarmPlan';

describe('remainingRingSeconds', () => {
  const start = at(13).getTime();
  it('is the full 2 minutes when the alarm has just started', () => {
    assert.equal(remainingRingSeconds(start, start), 120);
  });
  it('counts down while the alarm rings', () => {
    assert.equal(remainingRingSeconds(start, start + 45 * 1000), 75);
  });
  it('is zero once the 2 minutes are over, so a late opening stays silent', () => {
    assert.equal(remainingRingSeconds(start, start + 121 * 1000), 0);
    assert.equal(remainingRingSeconds(start, start + 60 * 60 * 1000), 0);
  });
  it('is zero before the alarm is due, and when the time is unknown', () => {
    assert.equal(remainingRingSeconds(start, start - 60 * 1000), 0);
    assert.equal(remainingRingSeconds(null, start), 0);
  });
  it('rings for a snoozed alarm from its own start, not the dose time', () => {
    const snoozedStart = start + 10 * 60 * 1000;
    assert.equal(remainingRingSeconds(snoozedStart, snoozedStart + 30 * 1000), 90);
  });
});
