import type { Reminder } from '../../domain/entities/Reminder';
import type { IReminderService } from '../../domain/services/IReminderService';
import type { DemoMedicineService } from './DemoMedicineService';
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

/** The one starting medicine that is already taken, so the dashboard shows a taken dose. */
const PRE_TAKEN = new Set(['Blood pressure tablet']);

/** Builds the doses for one day from the demo patient's medicines, like the real backend does. */
function remindersFromMedicines(
  day: string,
  medicines: DemoMedicineService,
  confirmed: ReadonlySet<string>,
  skipped: ReadonlySet<string>,
): Reminder[] {
  const [year, month, date] = day.split('-').map(Number);
  const doses: Reminder[] = [];
  for (const medicine of medicines.snapshot()) {
    if (day < medicine.startDate || (medicine.endDate !== null && day > medicine.endDate)) continue;
    medicine.times.forEach((time, index) => {
      const [hour, minute] = time.split(':').map(Number);
      const at = new Date(year, month - 1, date, hour, minute);
      // No doses for a moment before the medicine was added, or from the moment it was stopped.
      if (at.getTime() < medicines.addedAtMs(medicine.id)) return;
      if (medicine.stoppedAt !== null && at.getTime() >= Date.parse(medicine.stoppedAt)) return;
      const id = `${day}-${medicine.id}-${index}`;
      doses.push({
        id,
        medicineName: medicine.name,
        scheduledAt: at.toISOString(),
        acknowledged: PRE_TAKEN.has(medicine.name) || confirmed.has(id),
        skipped: skipped.has(id),
      });
    });
  }
  return doses.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.medicineName.localeCompare(b.medicineName));
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

  /**
   * With `medicines`, the doses follow the demo patient's medicines, so adding or stopping
   * one changes them. Without it, the same four fixed doses are shown every day.
   */
  constructor(
    private readonly latencyMs = 300,
    private readonly medicines: DemoMedicineService | null = null,
  ) {}

  async listForDay(userId: string, day: string): Promise<readonly Reminder[]> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    if (userId !== DEMO_PATIENT_ID) return [];
    return this.medicines
      ? remindersFromMedicines(day, this.medicines, this.confirmed, this.skipped)
      : remindersFor(day, this.confirmed, this.skipped);
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
