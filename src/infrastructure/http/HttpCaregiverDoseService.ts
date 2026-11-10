import type { PatientDose } from '../../domain/entities/PatientDose';
import type { ICaregiverDoseService } from '../../domain/services/ICaregiverDoseService';
import { ApiClient } from './ApiClient';
import { ApiError } from './ApiError';
import { deviceTimeZone } from './HttpAuthService';

function badAnswer(): ApiError {
  return new ApiError(200, 'bad_response', 'The server sent something the app could not read.');
}

const STATUSES = ['upcoming', 'due', 'taken', 'skipped', 'missed'] as const;

/** One dose as the backend sends it to a caregiver (ReminderOut in backend/app/schemas/medicines.py). */
export function toPatientDose(value: unknown): PatientDose {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw badAnswer();
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== 'string' ||
    typeof row.medicineName !== 'string' ||
    typeof row.scheduledAt !== 'string' ||
    Number.isNaN(Date.parse(row.scheduledAt)) ||
    typeof row.patientId !== 'string' ||
    typeof row.patientName !== 'string' ||
    typeof row.status !== 'string' ||
    !(STATUSES as readonly string[]).includes(row.status)
  ) {
    // One unreadable dose must not be quietly left out of a list a caregiver relies on.
    throw badAnswer();
  }
  return {
    id: row.id,
    medicineName: row.medicineName,
    scheduledAt: row.scheduledAt,
    patientId: row.patientId,
    patientName: row.patientName,
    acknowledged: row.status === 'taken',
    skipped: row.status === 'skipped',
  };
}

/**
 * The doses of every patient linked to the signed-in caregiver (GET /reminders). Read-only: the
 * server refuses to let a caregiver confirm or skip a dose. Only the day and the phone's time
 * zone are sent; who is asking comes from the sign-in token.
 */
export class HttpCaregiverDoseService implements ICaregiverDoseService {
  constructor(
    private readonly api: ApiClient,
    private readonly timeZone: () => string | undefined = deviceTimeZone,
  ) {}

  async listForDay(day: string): Promise<readonly PatientDose[]> {
    const answer = await this.api.get<unknown>('/reminders', { query: { day, timezone: this.timeZone() } });
    if (!Array.isArray(answer)) throw badAnswer();
    return answer.map(toPatientDose);
  }
}
