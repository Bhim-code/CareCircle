import type { AlarmEvent } from '../../application/alarmActions';
import type { PlannedRing } from '../../application/alarmPlan';
import type {
  AlarmLook,
  AlarmPermission,
  IAlarmScheduler,
} from '../../domain/services/IAlarmScheduler';

/** Does nothing. Used on the web and in tests, where the phone has no alarms to set. */
export class NoopAlarmScheduler implements IAlarmScheduler {
  async prepare(): Promise<void> {}
  async getPermission(): Promise<AlarmPermission> {
    return 'unavailable';
  }
  async requestPermission(): Promise<AlarmPermission> {
    return 'unavailable';
  }
  async openSettings(): Promise<void> {}
  async sync(_rings: readonly PlannedRing[], _look: AlarmLook, _answered: ReadonlySet<string>): Promise<void> {}
  async snooze(_id: string, _alarm: PlannedRing, _look: AlarmLook): Promise<void> {}
  async cancelFor(_reminderId: string): Promise<void> {}
  async cancelAll(): Promise<void> {}
  async scheduleTest(_look: AlarmLook): Promise<Date> {
    return new Date();
  }
  subscribe(_listener: (event: AlarmEvent) => void): () => void {
    return () => undefined;
  }
}
