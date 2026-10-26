import type { AlarmEvent } from '../../application/alarmActions';
import type { PlannedRing } from '../../application/alarmPlan';

/** Whether the phone lets CareCircle show alarms. */
export type AlarmPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/** How an alarm should sound. Changing it re-schedules the waiting alarms. */
export interface AlarmLook {
  readonly sound: boolean;
  readonly vibration: boolean;
}

/**
 * Puts alarms on the phone itself. They are scheduled on the device, so they
 * ring with no internet and while the app is closed.
 */
export interface IAlarmScheduler {
  /** Sets up the alarm sound channels and the Taken / Snooze / Skip buttons. Safe to call twice. */
  prepare(): Promise<void>;

  getPermission(): Promise<AlarmPermission>;

  /** Shows the phone's own permission question, if it has not been answered yet. */
  requestPermission(): Promise<AlarmPermission>;

  /** Opens the phone's settings page for this app, for a person who said no. */
  openSettings(): Promise<void>;

  /**
   * Makes the waiting alarms match `rings`. Alarms from a Snooze are left
   * alone, unless their dose is in `answeredIds`.
   */
  sync(rings: readonly PlannedRing[], look: AlarmLook, answeredIds: ReadonlySet<string>): Promise<void>;

  /** Replaces the waiting alarm for one dose with the snoozed one. */
  snooze(reminderId: string, alarm: PlannedRing, look: AlarmLook): Promise<void>;

  /** Removes every waiting alarm for one dose, and clears any already on screen. */
  cancelFor(reminderId: string): Promise<void>;

  /** Removes every waiting alarm. */
  cancelAll(): Promise<void>;

  /** Schedules a pretend dose so the alarm can be tried. Returns when it will ring. */
  scheduleTest(look: AlarmLook): Promise<Date>;

  /**
   * Tells the app when an alarm is opened or one of its buttons is pressed,
   * including the press that launched the app. Returns a function that stops listening.
   */
  subscribe(listener: (event: AlarmEvent) => void): () => void;
}
