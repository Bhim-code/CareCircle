import type { SyncedPreferences } from '../entities/UserPreferences';

/**
 * The settings the server keeps for the signed-in person (the ones that should follow them to
 * a new phone). Implementation: HttpPreferencesSync. Both methods reject with an error that has
 * a `code`, for example "network" when the phone cannot reach the server.
 */
export interface IPreferencesSync {
  fetch(): Promise<SyncedPreferences>;
  /** Saves the settings and returns what the server now holds. */
  push(preferences: SyncedPreferences): Promise<SyncedPreferences>;
}
