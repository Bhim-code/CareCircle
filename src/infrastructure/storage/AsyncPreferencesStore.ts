import AsyncStorage from '@react-native-async-storage/async-storage';
import { parsePreferences, preferencesKey } from '../../application/preferences';
import type { UserPreferences } from '../../domain/entities/UserPreferences';
import type { IPreferencesStore } from '../../domain/services/IPreferencesStore';

/**
 * Keeps settings on this device (in the browser, on web). They are not sent
 * to a server yet, so they do not follow the person to another phone.
 */
export class AsyncPreferencesStore implements IPreferencesStore {
  async load(userId: string): Promise<UserPreferences> {
    return parsePreferences(await AsyncStorage.getItem(preferencesKey(userId)));
  }

  async save(userId: string, preferences: UserPreferences): Promise<void> {
    await AsyncStorage.setItem(preferencesKey(userId), JSON.stringify(preferences));
  }
}
