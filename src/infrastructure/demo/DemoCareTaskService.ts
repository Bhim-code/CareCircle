import type {
  ClientDay,
  ExtraInput,
  ExtraWork,
  MarkInput,
  Person,
  TaskCounts,
  TaskItem,
  TaskStatus,
} from '../../domain/entities/CareTask';
import type { ICareTaskService } from '../../domain/services/ICareTaskService';
import { DEMO_CAREGIVER_ID, DEMO_PATIENT_ID } from './demoIds';

/** The demo plan: [id, title, time, instructions]. Every day. */
const PLAN: readonly (readonly [string, string, string | null, string | null])[] = [
  ['demo-task-1', 'Morning check-in', '09:00', 'Say good morning and ask how the night was.'],
  ['demo-task-2', 'Help with lunch', '12:30', 'Make sure Ana eats and drinks something.'],
  ['demo-task-3', 'Afternoon walk', '15:00', 'A short walk around the block if the weather allows.'],
  ['demo-task-4', 'Evening check-in', '19:30', null],
  ['demo-task-5', 'Tidy the kitchen', null, 'Any time that day.'],
];

const GRACE_MINUTES = 60;
const ANA: Person = { id: DEMO_PATIENT_ID, name: 'Ana Patient' };
const SAM: Person = { id: DEMO_CAREGIVER_ID, name: 'Sam Caregiver' };

interface Mark {
  status: 'done' | 'skipped';
  reason: string | null;
  note: string | null;
  doneBy: Person;
  doneAt: string;
}

function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Made-up care tasks for running the app with no server. The demo patient has five
 * tasks a day and the demo caregiver looks after them. Marks live only in memory.
 * Like the real backend, a patient may look but not mark, and a skip needs a reason.
 */
export class DemoCareTaskService implements ICareTaskService {
  private readonly marks = new Map<string, Mark>(); // "<taskId>|<day>"
  private extras: Array<ExtraWork & { day: string }> = [];
  private counter = 0;

  constructor(
    private readonly latencyMs = 300,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listDay(userId: string, day?: string): Promise<readonly ClientDay[]> {
    await this.pause();
    if (userId !== DEMO_PATIENT_ID && userId !== DEMO_CAREGIVER_ID) return [];
    return [this.buildDay(day ?? dayKey(this.now()))];
  }

  async mark(userId: string, taskId: string, day: string, input: MarkInput): Promise<ClientDay> {
    await this.pause();
    this.requireCaregiver(userId);
    if (!PLAN.some(([id]) => id === taskId)) throw new DemoError(404, 'not_found', 'Task not found.');
    this.requireRecordableDay(day);
    if (this.marks.has(`${taskId}|${day}`)) {
      throw new DemoError(409, 'already_marked', 'This task is already marked for that day.');
    }
    if (input.status === 'skipped' && input.reason.trim() === '') {
      throw new DemoError(422, 'invalid', 'Say why it was not done.');
    }
    this.marks.set(`${taskId}|${day}`, {
      status: input.status,
      reason: input.status === 'skipped' ? input.reason.trim() : null,
      note: input.note?.trim() || null,
      doneBy: SAM,
      doneAt: this.now().toISOString(),
    });
    return this.buildDay(day);
  }

  async undo(userId: string, taskId: string, day: string): Promise<void> {
    await this.pause();
    this.requireCaregiver(userId);
    const mark = this.marks.get(`${taskId}|${day}`);
    if (!mark) throw new DemoError(404, 'not_found', 'Nothing to undo.');
    if (mark.doneBy.id !== userId) throw new DemoError(403, 'forbidden', 'Only the person who marked it can undo it.');
    if (this.now().getTime() - Date.parse(mark.doneAt) > 24 * 60 * 60 * 1000) {
      throw new DemoError(422, 'too_late', 'It can only be undone within 24 hours.');
    }
    this.marks.delete(`${taskId}|${day}`);
  }

  async addExtra(userId: string, input: ExtraInput): Promise<ExtraWork> {
    await this.pause();
    this.requireCaregiver(userId);
    const day = input.day ?? dayKey(this.now());
    this.requireRecordableDay(day);
    this.counter += 1;
    const extra = {
      id: `demo-extra-${this.counter}`,
      title: input.title.trim(),
      note: input.note?.trim() || null,
      doneBy: SAM,
      doneAt: this.now().toISOString(),
      day,
    };
    this.extras = [...this.extras, extra];
    const { day: _day, ...shown } = extra;
    return shown;
  }

  private requireCaregiver(userId: string): void {
    if (userId !== DEMO_CAREGIVER_ID) throw new DemoError(403, 'forbidden', 'Your account is not allowed to do this.');
  }

  private requireRecordableDay(day: string): void {
    const today = dayKey(this.now());
    if (day > today) throw new DemoError(422, 'invalid', 'You cannot record a future day.');
  }

  private buildDay(day: string): ClientDay {
    const now = this.now();
    const tasks = PLAN.map(([taskId, title, time, instructions]): TaskItem => {
      const mark = this.marks.get(`${taskId}|${day}`) ?? null;
      return { taskId, title, instructions, time, status: statusOf(time, day, mark, now), mark };
    });
    const counts: Record<TaskStatus, number> = { upcoming: 0, due: 0, done: 0, late: 0, skipped: 0, missed: 0 };
    for (const task of tasks) counts[task.status] += 1;
    return {
      client: ANA,
      day,
      tasks,
      extras: this.extras.filter((extra) => extra.day === day).map(({ day: _day, ...rest }) => rest),
      counts: counts as TaskCounts,
    };
  }

  private pause(): Promise<void> {
    return this.latencyMs > 0 ? new Promise((resolve) => setTimeout(resolve, this.latencyMs)) : Promise.resolve();
  }
}

/** Same rules as the backend: due from the planned time, missed once the grace minutes have passed. */
function statusOf(time: string | null, day: string, mark: Mark | null, now: Date): TaskStatus {
  if (mark?.status === 'skipped') return 'skipped';
  const today = dayKey(now);
  const deadline = deadlineOf(time, day);
  if (mark) return Date.parse(mark.doneAt) > deadline ? 'late' : 'done';
  if (day > today) return 'upcoming';
  if (now.getTime() > deadline) return 'missed';
  if (time === null) return 'due';
  const start = startOf(time, day);
  return now.getTime() >= start ? 'due' : 'upcoming';
}

function startOf(time: string, day: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hours, minutes).getTime();
}

/** Time plus grace, or the end of the day for an "any time" task. */
function deadlineOf(time: string | null, day: string): number {
  if (time === null) {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59).getTime();
  }
  return startOf(time, day) + GRACE_MINUTES * 60 * 1000;
}

/** An error with a code, like the API client's, so screens treat the demo and the real thing alike. */
class DemoError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DemoError';
  }
}
