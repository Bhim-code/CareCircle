import AsyncStorage from '@react-native-async-storage/async-storage';
import type { IPushTokenStore } from '../../domain/services/IPushTokenStore';

const key = (userId: string) => `carecircle.pushToken.${userId}`;

/** Keeps the last push token this phone gave the server for a person, on this device. */
export class AsyncPushTokenStore implements IPushTokenStore {
  async get(userId: string): Promise<string | null> {
    return AsyncStorage.getItem(key(userId));
  }

  async set(userId: string, token: string): Promise<void> {
    await AsyncStorage.setItem(key(userId), token);
  }

  async clear(userId: string): Promise<void> {
    await AsyncStorage.removeItem(key(userId));
  }
}
