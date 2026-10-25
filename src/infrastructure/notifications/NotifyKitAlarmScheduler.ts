import notifee, {
  AlarmType,
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
  AuthorizationStatus,
  EventType,
  TriggerType,
  type Event,
  type Notification,
} from 'react-native-notify-kit';
import { Platform } from 'react-native';
import {
  ALARM_ACTION,
  ALARM_CATEGORY,
  TEST_ALARM_DELAY_SECONDS,
  TEST_REMINDER_PREFIX,
  type AlarmEvent,
  type AlarmEventKind,
} from '../../application/alarmActions';
import {
  RING_PREFIX,
  ringText,
  SNOOZE_PREFIX,
  type PlannedRing,
} from '../../application/alarmPlan';
import type {
  AlarmLook,
  AlarmPermission,
  IAlarmScheduler,
} from '../../domain/services/IAlarmScheduler';

/** Needed so the library does not warn when an alarm is pressed while the app is closed. */
notifee.onBackgroundEvent(async () => undefined);

/** Android fixes sound and vibration when a channel is made, so each combination gets its own. */
function channelId(look: AlarmLook): string {
  return `dose-alarm2-${look.sound ? 'sound' : 'quiet'}-${look.vibration ? 'vibrate' : 'still'}`;
}

function lookKey(look: AlarmLook): string {
  return `${look.sound ? 's' : 'q'}${look.vibration ? 'v' : 'n'}`;
}

const ACTION_TO_KIND: Record<string, AlarmEventKind> = {
  [ALARM_ACTION.taken]: 'taken',
  [ALARM_ACTION.snooze]: 'snooze',
  [ALARM_ACTION.skip]: 'skip',
};

function readData(
  data: unknown,
): { reminderId: string; medicineName: string; fireAt: number | null } | null {
  if (typeof data !== 'object' || data === null) return null;
  const { reminderId, medicineName, fireAt } = data as Record<string, unknown>;
  if (typeof reminderId !== 'string') return null;
  return {
    reminderId,
    medicineName: typeof medicineName === 'string' ? medicineName : 'your medicine',
    fireAt: typeof fireAt === 'number' ? fireAt : null,
  };
}

function toEvent(kind: AlarmEventKind, notification: Notification | undefined): AlarmEvent | null {
  const data = readData(notification?.data);
  return data ? { kind, ...data } : null;
}

/**
 * Alarms made with react-native-notify-kit. Each dose has one exact alarm-clock
 * trigger. On Android it is an ongoing alarm notification that asks to open over
 * the lock screen; the alarm screen then plays the looping sound itself, so
 * opening the notification panel cannot silence it. On iPhone it is a normal
 * time-sensitive notification, because iOS does not allow a ringing alarm.
 */
export class NotifyKitAlarmScheduler implements IAlarmScheduler {
  private prepared = false;

  async prepare(): Promise<void> {
    if (this.prepared) return;
    this.prepared = true;

    if (Platform.OS === 'android') {
      for (const sound of [true, false]) {
        for (const vibration of [true, false]) {
          const look = { sound, vibration };
          await notifee.createChannel({
            id: channelId(look),
            name: 'Medicine alarms',
            description: 'Rings when it is time to take a medicine.',
            importance: AndroidImportance.HIGH,
            sound: sound ? 'default' : undefined,
            vibration,
            vibrationPattern: vibration ? [300, 700, 300, 700, 300, 700] : undefined,
            visibility: AndroidVisibility.PUBLIC,
            bypassDnd: true,
          });
        }
      }
    } else {
      await notifee.setNotificationCategories([
        {
          id: ALARM_CATEGORY,
          actions: [
            { id: ALARM_ACTION.taken, title: 'Taken', foreground: true },
            { id: ALARM_ACTION.snooze, title: 'Snooze', foreground: true },
            { id: ALARM_ACTION.skip, title: 'Skip', foreground: true },
          ],
        },
      ]);
    }
  }

  async getPermission(): Promise<AlarmPermission> {
    const settings = await notifee.getNotificationSettings();
    if (settings.authorizationStatus === AuthorizationStatus.NOT_DETERMINED) return 'undetermined';
    if (settings.authorizationStatus === AuthorizationStatus.DENIED) return 'denied';
    // Android 12+ also needs "Alarms & reminders", or alarms can be late or missing.
    if (Platform.OS === 'android' && settings.android?.alarm === 0) return 'denied';
    return 'granted';
  }

  async requestPermission(): Promise<AlarmPermission> {
    await this.prepare();
    await notifee.requestPermission();
    return this.getPermission();
  }

  async openSettings(): Promise<void> {
    const settings = await notifee.getNotificationSettings();
    if (
      Platform.OS === 'android' &&
      settings.authorizationStatus === AuthorizationStatus.AUTHORIZED &&
      settings.android?.alarm === 0
    ) {
      await notifee.openAlarmPermissionSettings();
    } else {
      await notifee.openNotificationSettings();
    }
  }

  async sync(
    rings: readonly PlannedRing[],
    look: AlarmLook,
    answeredIds: ReadonlySet<string>,
  ): Promise<void> {
    await this.prepare();
    const waiting = await notifee.getTriggerNotifications();
    const key = lookKey(look);
    const reminderOf = (notification: Notification) => readData(notification.data)?.reminderId ?? '';

    // A dose that was snoozed keeps only its snooze alarm.
    const snoozed = new Set(
      waiting
        .filter((item) => (item.notification.id ?? '').startsWith(SNOOZE_PREFIX))
        .map((item) => reminderOf(item.notification)),
    );
    const wanted = new Map(
      rings.filter((ring) => !snoozed.has(ring.reminderId)).map((ring) => [ring.id, ring]),
    );
    const upToDate = new Set<string>();

    for (const item of waiting) {
      const id = item.notification.id ?? '';
      const isSnooze = id.startsWith(SNOOZE_PREFIX);
      const isRing = id.startsWith(RING_PREFIX);
      if (!isSnooze && !isRing) continue; // Not ours.

      const stale = isRing
        ? !wanted.has(id) || (item.notification.data as Record<string, unknown> | undefined)?.look !== key
        : answeredIds.has(reminderOf(item.notification));
      if (stale) await notifee.cancelTriggerNotification(id);
      else if (isRing) upToDate.add(id);
    }

    for (const ring of wanted.values()) {
      if (!upToDate.has(ring.id)) await this.schedule(ring, look);
    }
  }

  async snooze(reminderId: string, alarm: PlannedRing, look: AlarmLook): Promise<void> {
    await this.prepare();
    await this.cancelFor(reminderId);
    await this.schedule(alarm, look);
  }

  async cancelFor(reminderId: string): Promise<void> {
    for (const id of [`${RING_PREFIX}${reminderId}`, `${SNOOZE_PREFIX}${reminderId}`]) {
      // Takes it off the screen if it is showing, and removes it if it is still waiting.
      await notifee.cancelNotification(id).catch(() => undefined);
      await notifee.cancelTriggerNotification(id).catch(() => undefined);
    }
  }

  async cancelAll(): Promise<void> {
    const ids = await notifee.getTriggerNotificationIds();
    const ours = ids.filter((id) => id.startsWith(RING_PREFIX) || id.startsWith(SNOOZE_PREFIX));
    if (ours.length > 0) await notifee.cancelTriggerNotifications(ours);
  }

  async scheduleTest(look: AlarmLook): Promise<Date> {
    await this.prepare();
    const reminderId = `${TEST_REMINDER_PREFIX}${Date.now()}`;
    const fireAt = new Date(Date.now() + TEST_ALARM_DELAY_SECONDS * 1000);
    await this.schedule(
      {
        id: `${RING_PREFIX}${reminderId}`,
        reminderId,
        medicineName: 'Test medicine',
        fireAt,
        ringSeconds: 120,
        snoozed: false,
      },
      look,
    );
    return fireAt;
  }

  subscribe(listener: (event: AlarmEvent) => void): () => void {
    const handle = (event: Event) => {
      const { type, detail } = event;
      if (type === EventType.ACTION_PRESS) {
        const kind = ACTION_TO_KIND[detail.pressAction?.id ?? ''];
        const parsed = kind ? toEvent(kind, detail.notification) : null;
        if (parsed) listener(parsed);
      } else if (type === EventType.PRESS || type === EventType.DELIVERED) {
        // Tapped, or it rang while the app was open: show the alarm screen.
        const parsed = toEvent('open', detail.notification);
        if (parsed) listener(parsed);
      }
    };

    const stop = notifee.onForegroundEvent(handle);

    // The press (or the lock-screen takeover) that launched the app arrives before any listener exists.
    void notifee.getInitialNotification().then((initial) => {
      if (!initial) return;
      const kind = ACTION_TO_KIND[initial.pressAction?.id ?? ''] ?? 'open';
      const parsed = toEvent(kind, initial.notification);
      if (parsed) listener(parsed);
    });

    return stop;
  }

  private async schedule(ring: PlannedRing, look: AlarmLook): Promise<void> {
    const { title, body } = ringText(ring);
    const open = { id: 'default', launchActivity: 'default' };
    const notification: Notification = {
      id: ring.id,
      title,
      body,
      data: {
        reminderId: ring.reminderId,
        medicineName: ring.medicineName,
        fireAt: ring.fireAt.getTime(),
        look: lookKey(look),
      },
      android: {
        channelId: channelId(look),
        category: AndroidCategory.ALARM,
        importance: AndroidImportance.HIGH,
        // One notification that stays until the alarm is answered or has rung its full time.
        ongoing: true,
        autoCancel: false,
        loopSound: look.sound,
        timeoutAfter: ring.ringSeconds * 1000,
        pressAction: open,
        fullScreenAction: { id: 'alarm', launchActivity: 'default' },
        actions: [
          { title: 'Taken', pressAction: { id: ALARM_ACTION.taken, launchActivity: 'default' } },
          { title: 'Snooze', pressAction: { id: ALARM_ACTION.snooze, launchActivity: 'default' } },
          { title: 'Skip', pressAction: { id: ALARM_ACTION.skip, launchActivity: 'default' } },
        ],
      },
      ios: {
        categoryId: ALARM_CATEGORY,
        sound: look.sound ? 'default' : undefined,
        interruptionLevel: 'timeSensitive',
        foregroundPresentationOptions: { banner: true, list: true, sound: look.sound },
      },
    };
    await notifee.createTriggerNotification(notification, {
      type: TriggerType.TIMESTAMP,
      timestamp: ring.fireAt.getTime(),
      alarmManager: { type: AlarmType.SET_ALARM_CLOCK },
    });
  }
}
