/** Where one task stands for one day. The server works this out. */
export type TaskStatus = 'upcoming' | 'due' | 'done' | 'late' | 'skipped' | 'missed';

export interface Person {
  readonly id: string;
  readonly name: string;
}

/** Someone marked a task done, or skipped it. */
export interface TaskMark {
  readonly status: 'done' | 'skipped';
  readonly reason: string | null;
  readonly note: string | null;
  readonly doneBy: Person;
  /** ISO date and time. */
  readonly doneAt: string;
}

/** One planned task on one day. */
export interface TaskItem {
  readonly taskId: string;
  readonly title: string;
  readonly instructions: string | null;
  /** "HH:MM" in the client's time zone, or null for "any time that day". */
  readonly time: string | null;
  readonly status: TaskStatus;
  readonly mark: TaskMark | null;
}

/** Work that was done but was not in the plan, such as "Walk to the park". */
export interface ExtraWork {
  readonly id: string;
  readonly title: string;
  readonly note: string | null;
  readonly doneBy: Person;
  readonly doneAt: string;
}

export interface TaskCounts {
  readonly done: number;
  readonly late: number;
  readonly skipped: number;
  readonly missed: number;
  readonly due: number;
  readonly upcoming: number;
}

/** One client's day: their tasks and extra work. A patient gets one of these, a caregiver one per client. */
export interface ClientDay {
  readonly client: Person;
  /** YYYY-MM-DD in the client's time zone. */
  readonly day: string;
  readonly tasks: readonly TaskItem[];
  readonly extras: readonly ExtraWork[];
  readonly counts: TaskCounts;
}

export type MarkInput =
  | { readonly status: 'done'; readonly note?: string }
  | { readonly status: 'skipped'; readonly reason: string; readonly note?: string };

export interface ExtraInput {
  readonly title: string;
  readonly note?: string;
  /** Which client, for a caregiver with more than one. */
  readonly clientId?: string;
  readonly day?: string;
}
