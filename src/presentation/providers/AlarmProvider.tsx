import { router } from 'expo-router';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { isTestReminder, type AlarmEvent } from '../../application/alarmActions';
import { DEFAULT_ALARM, planRings, planSnooze, type AlarmSettings } from '../../application/alarmPlan';
import { dayKey } from '../../application/reminders';
import type { Reminder } from '../../domain/entities/Reminder';
import type { AlarmLook, AlarmPermission, IAlarmScheduler } from '../../domain/services/IAlarmScheduler';
import type { IReminderService } from '../../domain/services/IReminderService';
import { useNow } from '../hooks/useNow';
import { useAuth } from './AuthProvider';
import { usePreferences } from './PreferencesProvider';
import { useTodaysReminders } from './RemindersProvider';

export type AlarmOutcome = 'taken' | 'skipped' | 'snoozed';

export interface AlarmContextValue {
  readonly permission: AlarmPermission;
  /** Asks the phone for permission, or opens its settings if the person already said no. */
  askForPermission(): Promise<void>;
  /** Schedules a pretend dose to ring in 30 seconds. Returns the time it will ring. */
  sendTestAlarm(): Promise<Date>;
  /** Each returns true when it worked. They stop the remaining rings for that dose. */
  takeIt(reminderId: string): Promise<boolean>;
  skipIt(reminderId: string): Promise<boolean>;
  snoozeIt(reminderId: string, medicineName: string): Promise<boolean>;
  readonly snoozeMinutes: number;
}

const AlarmContext = createContext<AlarmContextValue | null>(null);

interface AlarmProviderProps {
  scheduler: IAlarmScheduler;
  /** Used to also load tomorrow's doses, so tomorrow morning's alarm is already set tonight. */
  reminderService: IReminderService;
  children: ReactNode;
}

function tomorrowOf(now: Date): string {
  return dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
}

function openAlarmScreen(
  event: { reminderId: string; medicineName: string; fireAt: number | null },
  done?: AlarmOutcome,
) {
  router.push({
    pathname: '/alarm',
    // `t` makes every opening distinct, so the screen resets even for the same dose.
    params: {
      id: event.reminderId,
      name: event.medicineName,
      t: String(Date.now()),
      ...(event.fireAt !== null ? { fire: String(event.fireAt) } : {}),
      ...(done ? { done } : {}),
    },
  });
}

/**
 * Keeps the phone's alarms in step with the patient's doses, and reacts when
 * an alarm is opened or one of its buttons is pressed. Only patients get alarms.
 */
export function AlarmProvider({ scheduler, reminderService, children }: AlarmProviderProps) {
  const { user, policy } = useAuth();
  const { preferences } = usePreferences();
  const { status: todayStatus, reminders: today, acknowledge, skip } = useTodaysReminders();
  const now = useNow();

  const enabled = Boolean(user && policy?.can('reminders.acknowledge'));
  const [permission, setPermission] = useState<AlarmPermission>('undetermined');
  // Bumped each time setup finishes, so the alarms are set again after a clean-up.
  const [setupRound, setSetupRound] = useState(0);
  // null until loaded. If loading fails it stays null, so alarms already on the phone are kept.
  const [tomorrow, setTomorrow] = useState<readonly Reminder[] | null>(null);

  const settings: AlarmSettings = useMemo(
    () => ({ ...DEFAULT_ALARM, snoozeMinutes: preferences.snoozeMinutes }),
    [preferences.snoozeMinutes],
  );
  const look: AlarmLook = useMemo(
    () => ({ sound: preferences.alarmSound, vibration: preferences.alarmVibration }),
    [preferences.alarmSound, preferences.alarmVibration],
  );

  // Set up the sound channels and buttons, and learn whether alarms are allowed.
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    scheduler
      .prepare()
      .then(() => scheduler.getPermission())
      .then((value) => {
        if (!active) return;
        setPermission(value);
        setSetupRound((round) => round + 1);
      })
      .catch(() => active && setPermission('unavailable'));
    return () => {
      active = false;
      // Signing out must not leave this person's alarms ringing on the phone.
      scheduler.cancelAll().catch(() => undefined);
    };
  }, [scheduler, enabled]);

  // Tomorrow's doses, reloaded when the date changes.
  const tomorrowKey = tomorrowOf(now);
  useEffect(() => {
    if (!enabled || !user) return;
    let active = true;
    reminderService
      .listForDay(user.id, tomorrowKey)
      .then((loaded) => active && setTomorrow(loaded))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [reminderService, enabled, user, tomorrowKey]);

  // Keep the phone's waiting alarms matching the doses.
  const wantAlarms = enabled && preferences.reminderNotifications && permission === 'granted';
  useEffect(() => {
    if (!enabled || permission === 'unavailable') return;
    // Never clear alarms just because the doses have not loaded (or could not load).
    if (todayStatus !== 'ready' || tomorrow === null) return;
    const all = [...today, ...tomorrow];
    const answered = new Set(all.filter((item) => item.acknowledged || item.skipped).map((item) => item.id));
    const rings = wantAlarms ? planRings(all, new Date(), settings) : [];
    scheduler.sync(rings, look, answered).catch(() => undefined);
  }, [scheduler, enabled, permission, setupRound, wantAlarms, todayStatus, today, tomorrow, settings, look]);

  // Signing out or switching the alarms off clears everything waiting.
  useEffect(() => {
    if (enabled && preferences.reminderNotifications) return;
    scheduler.cancelAll().catch(() => undefined);
  }, [scheduler, enabled, preferences.reminderNotifications]);

  const takeIt = useCallback(
    async (reminderId: string): Promise<boolean> => {
      await scheduler.cancelFor(reminderId).catch(() => undefined);
      return isTestReminder(reminderId) ? true : acknowledge(reminderId);
    },
    [scheduler, acknowledge],
  );

  const skipIt = useCallback(
    async (reminderId: string): Promise<boolean> => {
      await scheduler.cancelFor(reminderId).catch(() => undefined);
      return isTestReminder(reminderId) ? true : skip(reminderId);
    },
    [scheduler, skip],
  );

  const snoozeIt = useCallback(
    async (reminderId: string, medicineName: string): Promise<boolean> => {
      try {
        const alarm = planSnooze(reminderId, medicineName, new Date(), settings);
        await scheduler.snooze(reminderId, alarm, look);
        return true;
      } catch {
        return false;
      }
    },
    [scheduler, settings, look],
  );

  const askForPermission = useCallback(async () => {
    const result = await scheduler.requestPermission();
    // If the phone will not ask again, the only way is its settings page.
    if (result === 'denied') await scheduler.openSettings();
    setPermission(await scheduler.getPermission());
  }, [scheduler]);

  const sendTestAlarm = useCallback(
    () => scheduler.scheduleTest(look),
    [scheduler, look],
  );

  // React to an alarm being opened or a button on it being pressed.
  const latest = useRef({ today, takeIt, skipIt, snoozeIt });
  latest.current = { today, takeIt, skipIt, snoozeIt };
  useEffect(() => {
    if (!enabled) return;
    const handle = async (event: AlarmEvent) => {
      const { today: doses, takeIt: take, skipIt: skipDose, snoozeIt: snoozeDose } = latest.current;
      // A button is acted on straight away only when the dose is known. Otherwise
      // the alarm screen opens and the person presses the button there.
      const known = isTestReminder(event.reminderId) || doses.some((dose) => dose.id === event.reminderId);
      if (event.kind === 'open' || !known) return openAlarmScreen(event);

      if (event.kind === 'taken') {
        if (await take(event.reminderId)) openAlarmScreen(event, 'taken');
        else openAlarmScreen(event);
      } else if (event.kind === 'skip') {
        if (await skipDose(event.reminderId)) openAlarmScreen(event, 'skipped');
        else openAlarmScreen(event);
      } else if (event.kind === 'snooze') {
        if (await snoozeDose(event.reminderId, event.medicineName)) openAlarmScreen(event, 'snoozed');
        else openAlarmScreen(event);
      }
    };
    return scheduler.subscribe((event) => void handle(event));
  }, [scheduler, enabled]);

  const value = useMemo<AlarmContextValue>(
    () => ({
      permission,
      askForPermission,
      sendTestAlarm,
      takeIt,
      skipIt,
      snoozeIt,
      snoozeMinutes: settings.snoozeMinutes,
    }),
    [permission, askForPermission, sendTestAlarm, takeIt, skipIt, snoozeIt, settings.snoozeMinutes],
  );

  return <AlarmContext.Provider value={value}>{children}</AlarmContext.Provider>;
}

export function useAlarms(): AlarmContextValue {
  const context = useContext(AlarmContext);
  if (!context) throw new Error('useAlarms must be used inside <AlarmProvider>.');
  return context;
}
