import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dayKey,
  formatDate,
  formatTime,
  reminderStatus,
  summarizeToday,
} from '../src/application/reminders';
import type { Reminder } from '../src/domain/entities/Reminder';
import { DEMO_PATIENT_ID, DemoReminderService } from '../src/infrastructure/demo/DemoReminderService';
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

  it('is due from the scheduled time for one hour', () => {
    assert.equal(reminderStatus(reminder('a', at(13)), at(13)), 'due');
    assert.equal(reminderStatus(reminder('a', at(13)), at(14)), 'due');
  });

  it('is missed after the hour has passed', () => {
    assert.equal(reminderStatus(reminder('a', at(13)), at(14, 1)), 'missed');
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
    const summary = summarizeToday([reminder('now', at(15)), reminder('later', at(18))], at(15, 10));
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
