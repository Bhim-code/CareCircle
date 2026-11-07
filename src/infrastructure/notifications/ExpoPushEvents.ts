import * as Notifications from 'expo-notifications';
import type { IPushEvents } from '../../domain/services/IPushEvents';

// While the app is open it already shows the medicine alarm itself, so a notification from the
// server is not shown on top of it.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Only the notifications the server sent count here, not the app's own alarms. */
function fromServer(response: Notifications.NotificationResponse): boolean {
  const trigger = response.notification.request.trigger as { type?: string } | null;
  return trigger?.type === 'push';
}

const handled = new Set<string>();

/** Taps on notifications from the server (Expo's push service). */
export class ExpoPushEvents implements IPushEvents {
  onTap(listener: () => void): () => void {
    const handle = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (!fromServer(response) || handled.has(id)) return;
      handled.add(id);
      listener();
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(handle);
    // The tap that opened a closed app arrived before anything was listening.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handle(response);
    });
    return () => subscription.remove();
  }
}
