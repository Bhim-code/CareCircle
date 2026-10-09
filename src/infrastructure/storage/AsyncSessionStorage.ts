import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ISessionStorage } from '../../domain/services/ISessionStorage';

/** Keeps the session on the device (and in the browser, on web). */
export class AsyncSessionStorage implements ISessionStorage {
  getItem(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  }

  setItem(key: string, value: string): Promise<void> {
    return AsyncStorage.setItem(key, value);
  }

  removeItem(key: string): Promise<void> {
    return AsyncStorage.removeItem(key);
  }
}
