import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canUndo,
  describeTaskError,
  hasPermission,
  isOpen,
  replaceDay,
  sortTasks,
  summaryText,
  taskTimeText,
  validateExtra,
  validateSkip,
} from '../src/application/careTasks';
import type { ClientDay, TaskItem } from '../src/domain/entities/CareTask';

const SAM = { id: 'sam', name: 'Sam' };
const task = (over: Partial<TaskItem> = {}): TaskItem => ({
  taskId: 't', title: 'Task', instructions: null, time: '09:00', status: 'upcoming', mark: null, ...over,
});
const COUNTS = { done: 0, late: 0, skipped: 0, missed: 0, due: 0, upcoming: 0 };

describe('hasPermission', () => {
  it('is true only for a permission in the list, and false when there is no list', () => {
    assert.equal(hasPermission(['tasks.view'], 'tasks.view'), true);
    assert.equal(hasPermission(['tasks.view'], 'tasks.complete'), false);
    assert.equal(hasPermission(undefined, 'tasks.view'), false);
    assert.equal(hasPermission([], 'tasks.view'), false);
  });
});

describe('task text', () => {
  it('writes times on a 12-hour clock, and "Any time" when there is none', () => {
    assert.equal(taskTimeText('09:00'), '9:00 AM');
    assert.equal(taskTimeText('12:30'), '12:30 PM');
    assert.equal(taskTimeText('00:15'), '12:15 AM');
    assert.equal(taskTimeText('19:30'), '7:30 PM');
    assert.equal(taskTimeText(null), 'Any time');
  });

  it('sums up a day in plain words', () => {
    assert.equal(summaryText(COUNTS, 0), 'Nothing planned');
    assert.equal(summaryText({ ...COUNTS, done: 2, late: 1, upcoming: 1 }, 4), '3 of 4 done');
    assert.equal(summaryText({ ...COUNTS, done: 1, skipped: 1, missed: 1, due: 1 }, 4), '1 of 4 done, 1 skipped, 1 missed, 1 due now');
  });

  it('knows which statuses still need someone to act', () => {
    for (const status of ['upcoming', 'due', 'missed'] as const) assert.equal(isOpen(status), true, status);
    for (const status of ['done', 'late', 'skipped'] as const) assert.equal(isOpen(status), false, status);
  });
});

describe('sortTasks', () => {
  it('puts missed first, then due, then coming up, then finished ones, each by time', () => {
    const list = [
      task({ taskId: 'done', status: 'done', time: '08:00' }),
      task({ taskId: 'later', status: 'upcoming', time: '18:00' }),
      task({ taskId: 'anytime', status: 'upcoming', time: null }),
      task({ taskId: 'due', status: 'due', time: '12:00' }),
      task({ taskId: 'missed', status: 'missed', time: '10:00' }),
      task({ taskId: 'soon', status: 'upcoming', time: '15:00' }),
    ];
    assert.deepEqual(sortTasks(list).map((t) => t.taskId), ['missed', 'due', 'soon', 'later', 'anytime', 'done']);
  });

  it('does not change the list it was given', () => {
    const list = [task({ taskId: 'b', time: '10:00' }), task({ taskId: 'a', time: '08:00' })];
    sortTasks(list);
    assert.deepEqual(list.map((t) => t.taskId), ['b', 'a']);
  });
});

describe('canUndo', () => {
  const now = new Date('2026-11-06T15:00:00.000Z');
  const marked = (doneAt: string, by = SAM): TaskItem =>
    task({ status: 'done', mark: { status: 'done', reason: null, note: null, doneBy: by, doneAt } });

  it('lets the person who marked it undo within 24 hours', () => {
    assert.equal(canUndo(marked('2026-11-06T13:00:00.000Z'), 'sam', now), true);
    assert.equal(canUndo(marked('2026-11-05T15:30:00.000Z'), 'sam', now), true);
  });

  it('does not after 24 hours, for someone else, or when nothing is marked', () => {
    assert.equal(canUndo(marked('2026-11-05T14:00:00.000Z'), 'sam', now), false);
    assert.equal(canUndo(marked('2026-11-06T13:00:00.000Z'), 'someone-else', now), false);
    assert.equal(canUndo(task(), 'sam', now), false);
    assert.equal(canUndo(marked('not a date'), 'sam', now), false);
  });
});

describe('validateSkip', () => {
  it('needs a reason', () => {
    const result = validateSkip('   ', '');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'Say why it was skipped.');
  });

  it('builds the skip, trimmed, with the note only when there is one', () => {
    assert.deepEqual(validateSkip('  Ana was resting ', ''), { ok: true, input: { status: 'skipped', reason: 'Ana was resting' } });
    assert.deepEqual(validateSkip('Resting', ' asleep '), { ok: true, input: { status: 'skipped', reason: 'Resting', note: 'asleep' } });
  });

  it('refuses a reason or note that is too long', () => {
    assert.equal(validateSkip('x'.repeat(201), '').ok, false);
    assert.equal(validateSkip('ok', 'x'.repeat(2001)).ok, false);
  });
});

describe('validateExtra', () => {
  it('needs a title', () => {
    const result = validateExtra('  ', '');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errors.title, 'Write what was done.');
  });

  it('builds the entry, with the client when there is one', () => {
    assert.deepEqual(validateExtra(' Walk to the park ', ' sunny ', 'c-1'), {
      ok: true,
      input: { title: 'Walk to the park', note: 'sunny', clientId: 'c-1' },
    });
    assert.deepEqual(validateExtra('Walk', ''), { ok: true, input: { title: 'Walk' } });
  });

  it('refuses a title that is too long', () => {
    assert.equal(validateExtra('x'.repeat(101), '').ok, false);
  });
});

describe('replaceDay', () => {
  const day = (clientId: string, date: string, title: string): ClientDay => ({
    client: { id: clientId, name: clientId }, day: date, tasks: [task({ title })], extras: [], counts: COUNTS,
  });

  it('swaps in the updated day for the same client and date only', () => {
    const list = [day('a', '2026-11-06', 'old'), day('b', '2026-11-06', 'other')];
    const next = replaceDay(list, day('a', '2026-11-06', 'new'));
    assert.equal(next[0].tasks[0].title, 'new');
    assert.equal(next[1].tasks[0].title, 'other');
  });
});

describe('describeTaskError', () => {
  it('explains each kind of failure', () => {
    assert.match(describeTaskError({ code: 'network' }), /Cannot reach the server/);
    assert.match(describeTaskError({ code: 'session_expired' }), /sign-in has ended/);
    assert.match(describeTaskError({ code: 'forbidden' }), /not allowed/);
    assert.match(describeTaskError({ code: 'already_marked' }), /already marked/);
    assert.match(describeTaskError({ code: 'too_late' }), /24 hours/);
  });

  it("uses the backend's own sentence for a 422 or 409, which is written for a person", () => {
    assert.equal(describeTaskError({ status: 422, code: 'invalid', message: 'This task is not planned for that day.' }), 'This task is not planned for that day.');
    assert.equal(describeTaskError({ status: 409, code: 'conflict', message: 'Already done.' }), 'Already done.');
  });

  it('never shows a technical message for other failures', () => {
    assert.match(describeTaskError({ status: 500, code: 'server_error', message: 'Traceback ...' }), /could not save/);
    assert.match(describeTaskError(new Error('boom')), /could not save/);
    assert.match(describeTaskError(undefined), /could not save/);
  });
});
