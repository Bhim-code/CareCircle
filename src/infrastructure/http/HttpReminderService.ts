import type { Reminder } from '../../domain/entities/Reminder';
import type { IReminderService } from '../../domain/services/IReminderService';
import { ApiClient } from './ApiClient';
import { ApiError } from './ApiError';
import { deviceTimeZone } from './HttpAuthService';
import type { SkippedDoseStore } from './SkippedDoseStore';

/** One reminder as the backend sends it (ReminderOut in backend/app/schemas/medicines.py). */
interface ReminderDto {
  id?: unknown;
  medicineName?: unknown;
  scheduledAt?: unknown;
  acknowledged?: unknown;
}

function badAnswer(): ApiError {
  return new ApiError(200, 'bad_response', 'The server sent something the app could not read.');
}

function toReminder(dto: unknown, skipped: ReadonlySet<string>): Reminder {
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
    skipped: !row.acknowledged && skipped.has(row.id),
  };
}

/**
 * The patient's medication reminders from the CareCircle backend.
 *
 * The server only gives reminders to the signed-in patient, so `userId` is not sent:
 * who is asking comes from the sign-in token, and one person can never read another's
 * reminders. `userId` is used only to keep this phone's skipped doses apart per person.
 */
export class HttpReminderService implements IReminderService {
  constructor(
    private readonly api: ApiClient,
    private readonly skipped: SkippedDoseStore,
    private readonly timeZone: () => string | undefined = deviceTimeZone,
  ) {}

  async listForDay(userId: string, day: string): Promise<readonly Reminder[]> {
    // Sending the phone's time zone makes the server cut the day where the phone does.
    const answer = await this.api.get<unknown>('/reminders', {
      query: { day, timezone: this.timeZone() },
    });
    if (!Array.isArray(answer)) throw badAnswer();
    const skipped = await this.skipped.skippedBy(userId);
    return answer.map((item) => toReminder(item, skipped));
  }

  async acknowledge(_userId: string, reminderId: string): Promise<void> {
    // Pressing it twice is harmless on the server: the first time is kept.
    await this.api.post(`/reminders/${encodeURIComponent(reminderId)}/acknowledge`);
  }

  async skip(userId: string, reminderId: string): Promise<void> {
    // The backend has no "skip" yet, so it is remembered on this phone (see SkippedDoseStore).
    await this.skipped.add(userId, reminderId);
  }
}
