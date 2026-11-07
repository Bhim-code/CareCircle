import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { PushTokenResult } from '../../domain/entities/PushToken';
import type { IPushTokenSource } from '../../domain/services/IPushTokenSource';

/** The project the push service knows this app by (set by EAS in app.json). */
function projectId(): string | undefined {
  const fromConfig = Constants.expoConfig?.extra?.eas?.projectId;
  const fromEas = Constants.easConfig?.projectId;
  const id = typeof fromConfig === 'string' ? fromConfig : fromEas;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/** Asks Expo's push service for this phone's token. It never asks the person for permission. */
export class ExpoPushTokenSource implements IPushTokenSource {
  async getToken(): Promise<PushTokenResult> {
    try {
      // Push tokens only exist on a real phone with a development or release build.
      if (Platform.OS === 'web' || !Device.isDevice) return { kind: 'unavailable', reason: 'not_a_phone' };

      const permission = await Notifications.getPermissionsAsync();
      if (!permission.granted) return { kind: 'denied' };

      const id = projectId();
      if (!id) return { kind: 'unavailable', reason: 'no_project_id' };

      if (Platform.OS === 'android') {
        // Android 13 and newer need a notification channel before a token is given.
        await Notifications.setNotificationChannelAsync('default', {
          name: 'CareCircle',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
      return token.data ? { kind: 'token', token: token.data } : { kind: 'unavailable', reason: 'empty' };
    } catch {
      // For example an Android build without its Firebase setup, or no connection to the push service.
      return { kind: 'unavailable', reason: 'failed' };
    }
  }
}
