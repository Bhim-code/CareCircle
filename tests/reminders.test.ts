import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canAcknowledge,
  dayKey,
  formatDate,
  formatTime,
  reminderStatus,
  sortByTime,
  summarizeToday,
} from '../src/application/reminders';
import type { Reminder } from '../src/domain/entities/Reminder';
import { DEMO_PATIENT_ID } from '../src/infrastructure/demo/demoIds';
import { DemoReminderService } from '../src/infrastructure/demo/DemoReminderService';
import { EmptyReminderService } from '../src/infrastructure/supabase/EmptyReminderService';

// Monday 12 October 2026. Dates are built in local time, like the app does.
const at = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute);

function reminder(id: string, time: Date, acknowledged = false): Reminder {
  return { id, medicineName: `Medicine ${id}`, scheduledAt: time.toISOString(), acknowledged };
}

describe('reminderStatus', () => {
  it('is upcoming before the time', () => {
    assert.equal(reminderStatus(reminder('a', at(13)), at(12, 59)), 'upcoming');
  });

  it('is due from the scheduled time until the alarm has stopped and a few minutes have passed', () => {
    // The alarm rings 2 minutes from 13:00, then 3 minutes to react.
    assert.equal(reminderStatus(reminder('a', at(13)), at(13)), 'due');
    assert.equal(reminderStatus(reminder('a', at(13)), at(13, 5)), 'due');
  });

  it('is missed once the alarm has gone unanswered', () => {
    assert.equal(reminderStatus(reminder('a', at(13)), at(13, 6)), 'missed');
  });

  it('is skipped only when the person chose to skip, at any time', () => {
    const skipped = { ...reminder('a', at(13)), skipped: true };
    assert.equal(reminderStatus(skipped, at(9)), 'skipped');
    assert.equal(reminderStatus(skipped, at(20)), 'skipped');
  });

  it('a taken dose stays taken even if it was also marked skipped', () => {
    const both = { ...reminder('a', at(13), true), skipped: true };
    assert.equal(reminderStatus(both, at(14)), 'acknowledged');
  });

  it('is acknowledged only when the person confirmed it, at any time', () => {
    assert.equal(reminderStatus(reminder('a', at(13), true), at(9)), 'acknowledged');
    assert.equal(reminderStatus(reminder('a', at(13), true), at(20)), 'acknowledged');
  });

  it('never calls a reminder taken just because its time has passed', () => {
    assert.notEqual(reminderStatus(reminder('a', at(8)), at(20)), 'acknowledged');
  });
});

describe('summarizeToday', () => {
  it('handles a day with no reminders', () => {
    assert.deepEqual(summarizeToday([], at(10)), {
      total: 0,
      acknowledged: 0,
      skipped: 0,
      missed: 0,
      remaining: 0,
      next: null,
    });
  });

  it('counts each kind and picks the earliest open reminder as next', () => {
    const list = [
      reminder('late', at(21)),
      reminder('done', at(8), true),
      reminder('missed', at(10)),
      reminder('soon', at(18)),
    ];
    const summary = summarizeToday(list, at(15));
    assert.equal(summary.total, 4);
    assert.equal(summary.acknowledged, 1);
    assert.equal(summary.missed, 1);
    assert.equal(summary.remaining, 2);
    assert.equal(summary.next?.reminder.id, 'soon');
    assert.equal(summary.next?.status, 'upcoming');
  });

  it('shows a reminder that is due now as the next one', () => {
    const summary = summarizeToday([reminder('now', at(15)), reminder('later', at(18))], at(15, 4));
    assert.equal(summary.next?.reminder.id, 'now');
    assert.equal(summary.next?.status, 'due');
  });

  it('has no next reminder once everything is taken or missed', () => {
    const summary = summarizeToday([reminder('a', at(8), true), reminder('b', at(9))], at(20));
    assert.equal(summary.total, 2);
    assert.equal(summary.remaining, 0);
    assert.equal(summary.next, null);
  });
});

describe('date and time text', () => {
  it('writes the day key as YYYY-MM-DD', () => {
    assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');
  });

  it('writes a friendly date', () => {
    assert.equal(formatDate(at(9)), 'Monday, October 12');
  });

  it('writes times on a 12-hour clock', () => {
    assert.equal(formatTime(at(0, 5).toISOString()), '12:05 AM');
    assert.equal(formatTime(at(8).toISOString()), '8:00 AM');
    assert.equal(formatTime(at(12).toISOString()), '12:00 PM');
    assert.equal(formatTime(at(18, 30).toISOString()), '6:30 PM');
  });
});

describe('reminder services', () => {
  it('gives the demo patient reminders for the day asked for', async () => {
    const list = await new DemoReminderService(0).listForDay(DEMO_PATIENT_ID, '2026-10-12');
    assert.ok(list.length > 0);
    assert.ok(list.every((item) => dayKey(new Date(item.scheduledAt)) === '2026-10-12'));
  });

  it('gives everyone else an empty list, including the caregiver', async () => {
    const service = new DemoReminderService(0);
    assert.deepEqual(await service.listForDay('demo-caregiver@demo.test', '2026-10-12'), []);
    assert.deepEqual(await service.listForDay('someone-else', '2026-10-12'), []);
  });

  it('is always empty until the real backend exists', async () => {
    assert.deepEqual(await new EmptyReminderService().listForDay(DEMO_PATIENT_ID, '2026-10-12'), []);
  });
});

describe('confirming a dose', () => {
  it('can be done once a reminder is due or missed, but not before', () => {
    assert.equal(canAcknowledge('upcoming'), false);
    assert.equal(canAcknowledge('due'), true);
    assert.equal(canAcknowledge('missed'), true);
    assert.equal(canAcknowledge('acknowledged'), false);
  });

  it('marks only the confirmed reminder as taken, and keeps it that way', async () => {
    const service = new DemoReminderService(0);
    const before = await service.listForDay(DEMO_PATIENT_ID, '2026-10-12');
    const target = before.find((item) => !item.acknowledged);
    assert.ok(target);

    await service.acknowledge(DEMO_PATIENT_ID, target.id);

    const after = await service.listForDay(DEMO_PATIENT_ID, '2026-10-12');
    assert.equal(after.find((item) => item.id === target.id)?.acknowledged, true);
    const others = after.filter((item) => item.id !== target.id);
    const othersBefore = before.filter((item) => item.id !== target.id);
    assert.deepEqual(
      others.map((item) => item.acknowledged),
      othersBefore.map((item) => item.acknowledged),
    );
  });

  it('never marks anything as taken on its own', async () => {
    const service = new DemoReminderService(0);
    const first = await service.listForDay(DEMO_PATIENT_ID, '2026-10-12');
    const second = await service.listForDay(DEMO_PATIENT_ID, '2026-10-12');
    assert.deepEqual(first, second);
  });

  it('does not let anyone else confirm the demo patient\'s reminders', async () => {
    const service = new DemoReminderService(0);
    await assert.rejects(() => service.acknowledge('demo-caregiver@demo.test', '2026-10-12-1'));
    const list = await service.listForDay(DEMO_PATIENT_ID, '2026-10-12');
    assert.equal(list.find((item) => item.id === '2026-10-12-1')?.acknowledged, false);
  });

  it('fails clearly when there is no backend yet', async () => {
    await assert.rejects(() => new EmptyReminderService().acknowledge(DEMO_PATIENT_ID, 'x'));
  });
});

describe('sortByTime', () => {
  it('puts the earliest reminder first without changing the original list', () => {
    const list = [reminder('b', at(18)), reminder('a', at(8))];
    assert.deepEqual(sortByTime(list).map((item) => item.id), ['a', 'b']);
    assert.deepEqual(list.map((item) => item.id), ['b', 'a']);
  });
});

describe('skipping a dose', () => {
  it('is saved by the demo service for the demo patient', async () => {
    const service = new DemoReminderService(0);
    await service.skip(DEMO_PATIENT_ID, '2026-10-12-1');
    const list = await service.listForDay(DEMO_PATIENT_ID, '2026-10-12');
    assert.equal(list.find((item) => item.id === '2026-10-12-1')?.skipped, true);
    assert.equal(list.find((item) => item.id === '2026-10-12-2')?.skipped, false);
  });

  it('is refused for anyone else, so nobody can change another person\'s dose', async () => {
    const service = new DemoReminderService(0);
    await assert.rejects(service.skip('someone-else', '2026-10-12-1'));
  });

  it('is refused by the placeholder backend', async () => {
    await assert.rejects(new EmptyReminderService().skip('u', 'r'));
  });

  it('does not count as missed or remaining in the day summary', () => {
    const skipped = { ...reminder('s', at(10)), skipped: true };
    const summary = summarizeToday([skipped], at(15));
    assert.equal(summary.skipped, 1);
    assert.equal(summary.missed, 0);
    assert.equal(summary.remaining, 0);
  });
});
