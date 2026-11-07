import type { ClientDay, ExtraInput, ExtraWork, MarkInput } from '../entities/CareTask';

/**
 * The daily care tasks. Every method rejects with an error that has a `code`,
 * so screens can show a plain sentence (see describeTaskError).
 */
export interface ICareTaskService {
  /** Each client's tasks for a day (YYYY-MM-DD). Leave the day out for today. */
  listDay(userId: string, day?: string): Promise<readonly ClientDay[]>;
  /** Mark a task done, or skipped with a reason. Answers with that client's updated day. */
  mark(userId: string, taskId: string, day: string, input: MarkInput): Promise<ClientDay>;
  /** Take back a mark you made by mistake. Only possible for a day. */
  undo(userId: string, taskId: string, day: string): Promise<void>;
  /** Write down work that was not in the plan. */
  addExtra(userId: string, input: ExtraInput): Promise<ExtraWork>;
}
