import type { ClientDay, ExtraInput, MarkInput, TaskCounts, TaskItem, TaskStatus } from '../domain/entities/CareTask';

export const MAX_TITLE_LENGTH = 100;
export const MAX_REASON_LENGTH = 200;
export const MAX_NOTE_LENGTH = 2000;
/** The backend lets a person take back their own mark for this long. */
export const UNDO_WINDOW_HOURS = 24;

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  upcoming: 'Coming up',
  due: 'Due now',
  done: 'Done',
  late: 'Done late',
  skipped: 'Skipped',
  missed: 'Missed',
};

// The permission codes and the check live in permissions.ts. They are still offered from here.
export { TASKS_COMPLETE, TASKS_VIEW, hasPermission } from './permissions';

/** A task that still needs someone to act on it. */
export function isOpen(status: TaskStatus): boolean {
  return status === 'upcoming' || status === 'due' || status === 'missed';
}

/** "9:00 AM", or "Any time" for a task with no time. */
export function taskTimeText(time: string | null): string {
  if (time === null) return 'Any time';
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return time;
  const hours = Number(match[1]);
  return `${hours % 12 || 12}:${match[2]} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** "2 of 4 done, 1 missed" for the top of a client's list. */
export function summaryText(counts: TaskCounts, total: number): string {
  if (total === 0) return 'Nothing planned';
  const finished = counts.done + counts.late;
  const parts = [`${finished} of ${total} done`];
  if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`);
  if (counts.missed > 0) parts.push(`${counts.missed} missed`);
  if (counts.due > 0) parts.push(`${counts.due} due now`);
  return parts.join(', ');
}

/** Not-done tasks first (missed, due, coming up), then finished ones, each in time order. */
export function sortTasks(tasks: readonly TaskItem[]): TaskItem[] {
  const rank = (task: TaskItem) => (isOpen(task.status) ? (task.status === 'missed' ? 0 : task.status === 'due' ? 1 : 2) : 3);
  return [...tasks].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.time === b.time) return a.title.localeCompare(b.title);
    if (a.time === null) return 1;
    if (b.time === null) return -1;
    return a.time.localeCompare(b.time);
  });
}

/** Whether this person can still take back the mark on a task. */
export function canUndo(task: TaskItem, userId: string, now: Date): boolean {
  const mark = task.mark;
  if (!mark || mark.doneBy.id !== userId) return false;
  const doneAt = Date.parse(mark.doneAt);
  if (Number.isNaN(doneAt)) return false;
  return now.getTime() - doneAt < UNDO_WINDOW_HOURS * 60 * 60 * 1000;
}

export type SkipCheck = { readonly ok: true; readonly input: MarkInput } | { readonly ok: false; readonly error: string };

/** A skipped task needs a reason, so the next caregiver knows why. */
export function validateSkip(reason: string, note: string): SkipCheck {
  const cleanReason = reason.trim();
  if (cleanReason === '') return { ok: false, error: 'Say why it was skipped.' };
  if (cleanReason.length > MAX_REASON_LENGTH) {
    return { ok: false, error: `Please keep the reason under ${MAX_REASON_LENGTH} characters.` };
  }
  const cleanNote = note.trim();
  if (cleanNote.length > MAX_NOTE_LENGTH) return { ok: false, error: 'The note is too long.' };
  return { ok: true, input: { status: 'skipped', reason: cleanReason, ...(cleanNote ? { note: cleanNote } : {}) } };
}

export interface ExtraErrors {
  title?: string;
  note?: string;
}

export type ExtraCheck =
  | { readonly ok: true; readonly input: ExtraInput }
  | { readonly ok: false; readonly errors: ExtraErrors };

/** Checks the "extra work" form before anything is sent. */
export function validateExtra(title: string, note: string, clientId?: string): ExtraCheck {
  const errors: ExtraErrors = {};
  const cleanTitle = title.trim();
  if (cleanTitle === '') errors.title = 'Write what was done.';
  else if (cleanTitle.length > MAX_TITLE_LENGTH) errors.title = `Please keep this under ${MAX_TITLE_LENGTH} characters.`;
  const cleanNote = note.trim();
  if (cleanNote.length > MAX_NOTE_LENGTH) errors.note = 'The note is too long.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { title: cleanTitle, ...(cleanNote ? { note: cleanNote } : {}), ...(clientId ? { clientId } : {}) } };
}

/** The same client's day after a change, swapped into the list. */
export function replaceDay(days: readonly ClientDay[], updated: ClientDay): ClientDay[] {
  return days.map((day) => (day.client.id === updated.client.id && day.day === updated.day ? updated : day));
}

/**
 * A sentence for a failed task action. It reads only the error's `code`, `status` and
 * `message`, so it works for any backend. The backend's own message is used when it is
 * about this task, because it is already written for a person.
 */
export function describeTaskError(error: unknown): string {
  const read = (key: string): unknown =>
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>)[key] : undefined;
  const code = typeof read('code') === 'string' ? (read('code') as string) : '';
  const status = typeof read('status') === 'number' ? (read('status') as number) : 0;
  const message = typeof read('message') === 'string' ? (read('message') as string) : '';
  switch (code) {
    case 'network':
    case 'timeout':
      return 'Cannot reach the server. Check your connection and try again.';
    case 'too_many_requests':
      return 'Too many requests. Wait a minute, then try again.';
    case 'session_expired':
    case 'unauthenticated':
      return 'Your sign-in has ended. Please sign in again.';
    case 'forbidden':
      return 'Your account is not allowed to do this.';
    case 'already_marked':
      return 'Someone already marked this task. Tap Refresh to update the list.';
    case 'too_late':
      return `A mark can only be taken back within ${UNDO_WINDOW_HOURS} hours.`;
    default:
      // 409 and 422 answers come with a sentence meant for the person.
      if ((status === 409 || status === 422) && message !== '') return message;
      return 'We could not save that. Please try again.';
  }
}
