import type { UserPreferences } from '../entities/UserPreferences';

/**
 * Where a person's settings are kept between app launches.
 * Settings are stored per user id, so two people sharing a phone never see
 * each other's choices. Implementations: AsyncPreferencesStore (device) and
 * MemoryPreferencesStore (tests).
 */
export interface IPreferencesStore {
  /** Returns the saved settings, or the defaults when nothing is saved or the data is unreadable. */
  load(userId: string): Promise<UserPreferences>;
  save(userId: string, preferences: UserPreferences): Promise<void>;
}
