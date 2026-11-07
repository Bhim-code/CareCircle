import type { SyncedPreferences } from '../../domain/entities/UserPreferences';
import type { IPreferencesSync } from '../../domain/services/IPreferencesSync';
import { ApiClient } from './ApiClient';
import { ApiError } from './ApiError';

/** Reads the four switches the backend keeps (PreferencesIO in backend/app/schemas/me.py). */
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
  return { largerText, reminderNotifications, missedDoseEmail, missedDoseCall };
}

/** Settings kept on the CareCircle backend (GET and PUT /me/preferences). */
export class HttpPreferencesSync implements IPreferencesSync {
  constructor(private readonly api: ApiClient) {}

  async fetch(): Promise<SyncedPreferences> {
    return toSyncedPreferences(await this.api.get<unknown>('/me/preferences'));
  }

  async push(preferences: SyncedPreferences): Promise<SyncedPreferences> {
    // The backend wants all four on every save.
    return toSyncedPreferences(
      await this.api.put<unknown>('/me/preferences', {
        largerText: preferences.largerText,
        reminderNotifications: preferences.reminderNotifications,
        missedDoseEmail: preferences.missedDoseEmail,
        missedDoseCall: preferences.missedDoseCall,
      }),
    );
  }
}
