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

  private readonly dirty = new Set<string>();

  async isDirty(userId: string): Promise<boolean> {
    return this.dirty.has(userId);
  }

  async setDirty(userId: string, dirty: boolean): Promise<void> {
    if (dirty) this.dirty.add(userId);
    else this.dirty.delete(userId);
  }
}
