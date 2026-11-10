import type { Reminder } from '../../domain/entities/Reminder';
import type { IReminderService } from '../../domain/services/IReminderService';
import { ApiClient } from './ApiClient';
import { ApiError } from './ApiError';
import { deviceTimeZone } from './HttpAuthService';

/** One reminder as the backend sends it (ReminderOut in backend/app/schemas/medicines.py). */
interface ReminderDto {
  id?: unknown;
  medicineName?: unknown;
  scheduledAt?: unknown;
  acknowledged?: unknown;
  skipped?: unknown;
}

function badAnswer(): ApiError {
  return new ApiError(200, 'bad_response', 'The server sent something the app could not read.');
}

function toReminder(dto: unknown): Reminder {
  if (typeof dto !== 'object' || dto === null) throw badAnswer();
  const row = dto as ReminderDto;
  if (
    typeof row.id !== 'string' ||
    typeof row.medicineName !== 'string' ||
    typeof row.scheduledAt !== 'string' ||
    Number.isNaN(Date.parse(row.scheduledAt)) ||
    typeof row.acknowledged !== 'boolean'
  ) {
    // One unreadable dose must not be quietly left out of a medication list.
    throw badAnswer();
  }
  return {
    id: row.id,
    medicineName: row.medicineName,
    scheduledAt: row.scheduledAt,
    acknowledged: row.acknowledged,
    // The server remembers skips, so they show on every phone. A dose that was taken is never "skipped".
    skipped: row.acknowledged === false && row.skipped === true,
  };
}

/**
 * The patient's medication reminders from the CareCircle backend.
 *
 * The server only gives reminders to the signed-in patient, so `userId` is not sent:
 * who is asking comes from the sign-in token, and one person can never read another's
 * reminders.
 */
export class HttpReminderService implements IReminderService {
  constructor(
    private readonly api: ApiClient,
    private readonly timeZone: () => string | undefined = deviceTimeZone,
  ) {}

  async listForDay(_userId: string, day: string): Promise<readonly Reminder[]> {
    // Sending the phone's time zone makes the server cut the day where the phone does.
    const answer = await this.api.get<unknown>('/reminders', {
      query: { day, timezone: this.timeZone() },
    });
    if (!Array.isArray(answer)) throw badAnswer();
    return answer.map(toReminder);
  }

  async acknowledge(_userId: string, reminderId: string): Promise<void> {
    // Pressing it twice is harmless on the server: the first time is kept.
    await this.api.post(`/reminders/${encodeURIComponent(reminderId)}/acknowledge`);
  }

  async skip(_userId: string, reminderId: string): Promise<void> {
    // The server keeps the skip, so it shows on every phone and sends no missed-dose alert.
    // Skipping twice is harmless. A dose already taken answers 409 "already_taken", and one
    // more than 60 minutes early answers 422 "not_due".
    await this.api.post(`/reminders/${encodeURIComponent(reminderId)}/skip`);
  }
}
