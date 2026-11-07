import type { AccessView } from '../../domain/entities/AccessView';
import type { IAccessLogService } from '../../domain/services/IAccessLogService';
import { ApiClient } from './ApiClient';
import { ApiError } from './ApiError';

function badAnswer(): ApiError {
  return new ApiError(200, 'bad_response', 'The server sent something the app could not read.');
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw badAnswer();
  return value;
}

/** Reads one view as the backend sends it (AccessLogEntryOut in backend/app/api/routes/me.py). */
export function toAccessView(value: unknown): AccessView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw badAnswer();
  const row = value as Record<string, unknown>;
  const viewer = row.viewer;
  if (typeof viewer !== 'object' || viewer === null || Array.isArray(viewer)) throw badAnswer();
  const who = viewer as Record<string, unknown>;
  return {
    at: text(row.at),
    viewer: { id: text(who.id), name: text(who.name), role: text(who.role) },
    action: text(row.action),
  };
}

/** Who has viewed the patient's records (GET /me/access-log, patients only). */
export class HttpAccessLogService implements IAccessLogService {
  constructor(private readonly api: ApiClient) {}

  async list(_userId: string): Promise<readonly AccessView[]> {
    const rows = await this.api.get<unknown>('/me/access-log');
    if (!Array.isArray(rows)) throw badAnswer();
    return rows.map(toAccessView);
  }
}
