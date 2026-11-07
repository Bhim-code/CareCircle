import type { ClientDay, ExtraInput, ExtraWork, MarkInput, Person, TaskItem, TaskMark } from '../../domain/entities/CareTask';
import type { ICareTaskService } from '../../domain/services/ICareTaskService';
import { ApiClient } from './ApiClient';
import { ApiError } from './ApiError';

function badAnswer(): ApiError {
  return new ApiError(200, 'bad_response', 'The server sent something the app could not read.');
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const STATUSES = ['upcoming', 'due', 'done', 'late', 'skipped', 'missed'] as const;

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw badAnswer();
  return value;
}

function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return text(value);
}

function toPerson(value: unknown): Person {
  if (!isRow(value)) throw badAnswer();
  return { id: text(value.id), name: text(value.name) };
}

function toMark(value: unknown): TaskMark | null {
  if (value === null || value === undefined) return null;
  if (!isRow(value) || (value.status !== 'done' && value.status !== 'skipped')) throw badAnswer();
  return {
    status: value.status,
    reason: textOrNull(value.reason),
    note: textOrNull(value.note),
    doneBy: toPerson(value.doneBy),
    doneAt: text(value.doneAt),
  };
}

function toTask(value: unknown): TaskItem {
  if (!isRow(value)) throw badAnswer();
  const status = value.status;
  if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) throw badAnswer();
  const time = textOrNull(value.time);
  if (time !== null && !TIME.test(time)) throw badAnswer();
  return {
    taskId: text(value.taskId),
    title: text(value.title),
    instructions: textOrNull(value.instructions),
    time,
    status: status as TaskItem['status'],
    mark: toMark(value.completion),
  };
}

function toExtra(value: unknown): ExtraWork {
  if (!isRow(value)) throw badAnswer();
  return {
    id: text(value.id),
    title: text(value.title),
    note: textOrNull(value.note),
    doneBy: toPerson(value.doneBy),
    doneAt: text(value.doneAt),
  };
}

function count(counts: Row, key: string): number {
  const value = counts[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Reads one client's day as the backend sends it (PatientDayOut in backend/app/schemas/tasks.py). */
export function toClientDay(value: unknown): ClientDay {
  if (!isRow(value) || !Array.isArray(value.tasks) || !Array.isArray(value.extras) || !isRow(value.counts)) {
    throw badAnswer();
  }
  const day = text(value.day);
  if (!DAY.test(day)) throw badAnswer();
  const counts = value.counts;
  return {
    client: toPerson(value.patient),
    day,
    // One unreadable task must not be quietly left out of a care list.
    tasks: value.tasks.map(toTask),
    extras: value.extras.map(toExtra),
    counts: {
      done: count(counts, 'done'),
      late: count(counts, 'late'),
      skipped: count(counts, 'skipped'),
      missed: count(counts, 'missed'),
      due: count(counts, 'due'),
      upcoming: count(counts, 'upcoming'),
    },
  };
}

/** Daily care tasks against the CareCircle backend (backend/app/api/routes/tasks.py). */
export class HttpCareTaskService implements ICareTaskService {
  constructor(private readonly api: ApiClient) {}

  async listDay(_userId: string, day?: string): Promise<readonly ClientDay[]> {
    const answer = await this.api.get<unknown>('/tasks', { query: day ? { day } : undefined });
    if (!Array.isArray(answer)) throw badAnswer();
    return answer.map(toClientDay);
  }

  async mark(_userId: string, taskId: string, day: string, input: MarkInput): Promise<ClientDay> {
    const body = {
      day,
      status: input.status,
      ...(input.status === 'skipped' ? { reason: input.reason } : {}),
      ...(input.note ? { note: input.note } : {}),
    };
    return toClientDay(await this.api.post<unknown>(`/tasks/${encodeURIComponent(taskId)}/complete`, body));
  }

  async undo(_userId: string, taskId: string, day: string): Promise<void> {
    await this.api.delete<void>(`/tasks/${encodeURIComponent(taskId)}/complete`, undefined, { query: { day } });
  }

  async addExtra(_userId: string, input: ExtraInput): Promise<ExtraWork> {
    return toExtra(
      await this.api.post<unknown>('/tasks/extra', {
        title: input.title,
        ...(input.note ? { note: input.note } : {}),
        ...(input.clientId ? { patientId: input.clientId } : {}),
        ...(input.day ? { day: input.day } : {}),
      }),
    );
  }
}
