import type { Reminder } from '../../domain/entities/Reminder';
import type { IReminderService } from '../../domain/services/IReminderService';
import { DEMO_PATIENT_ID } from './demoIds';

// Made-up daily schedule: [medicine, hour, minute, already taken?]
const DEMO_SCHEDULE: readonly (readonly [string, number, number, boolean])[] = [
  ['Blood pressure tablet', 8, 0, true],
  ['Metformin', 13, 0, false],
  ['Vitamin D', 18, 30, false],
  ['Evening heart tablet', 21, 0, false],
];

/** Builds the demo reminders for one day, e.g. "2026-10-12". Confirmed ones are passed in. */
function remindersFor(day: string, confirmed: ReadonlySet<string>, skipped: ReadonlySet<string>): Reminder[] {
  const [year, month, date] = day.split('-').map(Number);
  return DEMO_SCHEDULE.map(([medicineName, hour, minute, acknowledged], index) => ({
    id: `${day}-${index}`,
    medicineName,
    scheduledAt: new Date(year, month - 1, date, hour, minute).toISOString(),
    acknowledged: acknowledged || confirmed.has(`${day}-${index}`),
    skipped: skipped.has(`${day}-${index}`),
  }));
}

/**
 * Made-up reminders for running the app with no server, so the dashboard can be
 * seen working. Only the demo patient has any; everyone else starts empty.
 * Used in development builds only.
 */
export class DemoReminderService implements IReminderService {
  /** Reminders the person has confirmed since the app started. Lost on reload, like all demo data. */
  private readonly confirmed = new Set<string>();
  private readonly skipped = new Set<string>();

  constructor(private readonly latencyMs = 300) {}

  async listForDay(userId: string, day: string): Promise<readonly Reminder[]> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    return userId === DEMO_PATIENT_ID ? remindersFor(day, this.confirmed, this.skipped) : [];
  }

  async acknowledge(userId: string, reminderId: string): Promise<void> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    // Only the demo patient owns reminders, so nobody else can confirm one.
    if (userId !== DEMO_PATIENT_ID) throw new Error('Reminder not found.');
    this.confirmed.add(reminderId);
  }

  async skip(userId: string, reminderId: string): Promise<void> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    if (userId !== DEMO_PATIENT_ID) throw new Error('Reminder not found.');
    this.skipped.add(reminderId);
  }
}
