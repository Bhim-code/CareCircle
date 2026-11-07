import AsyncStorage from '@react-native-async-storage/async-storage';
import { parsePreferences, preferencesDirtyKey, preferencesKey } from '../../application/preferences';
import type { UserPreferences } from '../../domain/entities/UserPreferences';
import type { IPreferencesStore } from '../../domain/services/IPreferencesStore';

/**
 * Keeps settings on this device (in the browser, on web), so the app opens with them even
 * with no connection. The ones the server also keeps are synced by the PreferencesProvider.
 */
export class AsyncPreferencesStore implements IPreferencesStore {
  async load(userId: string): Promise<UserPreferences> {
    return parsePreferences(await AsyncStorage.getItem(preferencesKey(userId)));
  }

  async save(userId: string, preferences: UserPreferences): Promise<void> {
    await AsyncStorage.setItem(preferencesKey(userId), JSON.stringify(preferences));
  }

  async isDirty(userId: string): Promise<boolean> {
    return (await AsyncStorage.getItem(preferencesDirtyKey(userId))) === '1';
  }

  async setDirty(userId: string, dirty: boolean): Promise<void> {
    if (dirty) await AsyncStorage.setItem(preferencesDirtyKey(userId), '1');
    else await AsyncStorage.removeItem(preferencesDirtyKey(userId));
  }
}
