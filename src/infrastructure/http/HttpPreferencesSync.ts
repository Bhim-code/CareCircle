import { SNOOZE_CHOICES, type SyncedPreferences } from '../../domain/entities/UserPreferences';
import type { IPreferencesSync } from '../../domain/services/IPreferencesSync';
import { ApiClient } from './ApiClient';
import { ApiError } from './ApiError';

/**
 * Reads the settings the backend keeps (PreferencesOut in backend/app/schemas/me.py): the four
 * switches, and the alarm's sound, vibration and snooze length. A server that does not send
 * the alarm settings yet gives only the four. A snooze length the app does not offer is
 * dropped, so the phone keeps its own.
 */
export function toSyncedPreferences(value: unknown): SyncedPreferences {
  const bad = () => new ApiError(200, 'bad_response', 'The server sent something the app could not read.');
  if (typeof value !== 'object' || value === null) throw bad();
  const row = value as Record<string, unknown>;
  const { largerText, reminderNotifications, missedDoseEmail, missedDoseCall } = row;
  if (
    typeof largerText !== 'boolean' ||
    typeof reminderNotifications !== 'boolean' ||
    typeof missedDoseEmail !== 'boolean' ||
    typeof missedDoseCall !== 'boolean'
  ) {
    throw bad();
  }
  const result: SyncedPreferences = { largerText, reminderNotifications, missedDoseEmail, missedDoseCall };
  const { alarmSound, alarmVibration, snoozeMinutes } = row;
  return {
    ...result,
    ...(typeof alarmSound === 'boolean' ? { alarmSound } : {}),
    ...(typeof alarmVibration === 'boolean' ? { alarmVibration } : {}),
    ...(typeof snoozeMinutes === 'number' && (SNOOZE_CHOICES as readonly number[]).includes(snoozeMinutes)
      ? { snoozeMinutes }
      : {}),
  };
}

/** Settings kept on the CareCircle backend (GET and PUT /me/preferences). */
export class HttpPreferencesSync implements IPreferencesSync {
  constructor(private readonly api: ApiClient) {}

  async fetch(): Promise<SyncedPreferences> {
    return toSyncedPreferences(await this.api.get<unknown>('/me/preferences'));
  }

  async push(preferences: SyncedPreferences): Promise<SyncedPreferences> {
    // The backend wants the four switches on every save; the alarm settings go with them.
    return toSyncedPreferences(
      await this.api.put<unknown>('/me/preferences', {
        largerText: preferences.largerText,
        reminderNotifications: preferences.reminderNotifications,
        missedDoseEmail: preferences.missedDoseEmail,
        missedDoseCall: preferences.missedDoseCall,
        ...(preferences.alarmSound !== undefined ? { alarmSound: preferences.alarmSound } : {}),
        ...(preferences.alarmVibration !== undefined ? { alarmVibration: preferences.alarmVibration } : {}),
        ...(preferences.snoozeMinutes !== undefined ? { snoozeMinutes: preferences.snoozeMinutes } : {}),
      }),
    );
  }
}
