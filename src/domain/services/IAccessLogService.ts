import type { AccessView } from '../entities/AccessView';

/** Who has looked at the signed-in patient's information. */
export interface IAccessLogService {
  /** The latest views, newest first. Rejects with an error that has a `code`, for example "network". */
  list(userId: string): Promise<readonly AccessView[]>;
}
