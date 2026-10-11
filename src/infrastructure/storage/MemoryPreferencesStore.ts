import { DEFAULT_PREFERENCES, type UserPreferences } from '../../domain/entities/UserPreferences';
import type { IPreferencesStore } from '../../domain/services/IPreferencesStore';

/** Keeps settings in memory only. Used by tests. */
export class MemoryPreferencesStore implements IPreferencesStore {
  private readonly items = new Map<string, UserPreferences>();

  async load(userId: string): Promise<UserPreferences> {
    return this.items.get(userId) ?? DEFAULT_PREFERENCES;
  }

  async save(userId: string, preferences: UserPreferences): Promise<void> {
    this.items.set(userId, preferences);
  }
}
