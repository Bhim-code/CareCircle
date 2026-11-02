import type { Medicine, MedicineInput } from '../domain/entities/Medicine';
import { dayKey } from './reminders';
import { parseDateText, parseTimeText } from './recordEntries';

export const MAX_NAME_LENGTH = 100;
/** The most times of day one medicine can have (the backend's limit). */
export const MAX_TIMES = 12;

/** Quick ways to fill in a time, for people who would rather tap than type. */
export const QUICK_TIMES: readonly { readonly label: string; readonly time: string }[] = [
  { label: 'Morning', time: '08:00' },
  { label: 'Noon', time: '12:00' },
  { label: 'Evening', time: '18:00' },
  { label: 'Bedtime', time: '21:00' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** "08:00" -> "8:00 AM", "20:30" -> "8:30 PM". Anything else is returned as it came. */
export function formatTimeKey(time: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return time;
  const hours = Number(match[1]);
  return `${hours % 12 || 12}:${match[2]} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** "2026-11-05" -> "Nov 5, 2026" */
export function formatDateKey(date: string): string {
  const parsed = parseDateText(date);
  if (!parsed) return date;
  return `${MONTHS[parsed.month - 1]} ${parsed.day}, ${parsed.year}`;
}

/** "8:00 AM, 8:00 PM" */
export function scheduleText(times: readonly string[]): string {
  return times.map(formatTimeKey).join(', ');
}

// ---------------------------------------------------------------- the form

/** Everything on the form as the person typed it. */
export interface MedicineDraft {
  name: string;
  /** One text per time box. Boxes left empty are ignored. */
  times: string[];
  startDate: string;
  endDate: string;
}

export interface MedicineDraftErrors {
  name?: string;
  /** About the times as a whole, such as "Add at least one time". */
  times?: string;
  /** About one time box, in the same order as the boxes. */
  timeAt?: Array<string | undefined>;
  startDate?: string;
  endDate?: string;
}

export function blankMedicineDraft(now: Date): MedicineDraft {
  return { name: '', times: [''], startDate: dayKey(now), endDate: '' };
}

export type MedicineDraftResult =
  | { readonly ok: true; readonly input: MedicineInput }
  | { readonly ok: false; readonly errors: MedicineDraftErrors };

/**
 * Checks the form the same way the backend will, so the person is told what to fix
 * before anything is sent. The backend still checks again.
 */
export function validateMedicineDraft(draft: MedicineDraft, now: Date): MedicineDraftResult {
  const errors: MedicineDraftErrors = {};

  const name = draft.name.trim();
  if (name === '') errors.name = "Enter the medicine's name.";
  else if (name.length > MAX_NAME_LENGTH) errors.name = `Please keep the name under ${MAX_NAME_LENGTH} characters.`;

  const timeAt: Array<string | undefined> = draft.times.map(() => undefined);
  const seen = new Map<string, number>();
  const times: string[] = [];
  draft.times.forEach((text, index) => {
    if (text.trim() === '') return;
    const parsed = parseTimeText(text);
    if (!parsed) {
      timeAt[index] = 'Write a time like 8:00 AM or 20:30.';
      return;
    }
    const key = `${pad(parsed.hours)}:${pad(parsed.minutes)}`;
    if (seen.has(key)) {
      timeAt[index] = 'This time is already listed.';
      return;
    }
    seen.set(key, index);
    times.push(key);
  });
  if (timeAt.some(Boolean)) errors.timeAt = timeAt;
  const typed = draft.times.filter((text) => text.trim() !== '').length;
  if (typed === 0) errors.times = 'Add at least one time.';
  else if (typed > MAX_TIMES) errors.times = `A medicine can have up to ${MAX_TIMES} times a day.`;

  const start = parseDateText(draft.startDate);
  let startKey = '';
  if (!start) errors.startDate = 'Write the date like 2026-10-29.';
  else startKey = `${start.year}-${pad(start.month)}-${pad(start.day)}`;

  let endKey: string | null = null;
  if (draft.endDate.trim() !== '') {
    const end = parseDateText(draft.endDate);
    if (!end) {
      errors.endDate = 'Write the date like 2026-11-05, or leave it empty.';
    } else {
      endKey = `${end.year}-${pad(end.month)}-${pad(end.day)}`;
      if (startKey && endKey < startKey) errors.endDate = 'The end date cannot be before the start date.';
      else if (endKey < dayKey(now)) errors.endDate = 'The end date has already passed.';
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: { name, times: [...times].sort(), startDate: startKey, endDate: endKey },
  };
}

// ---------------------------------------------------------------- the list

/** Still being taken: not stopped, and not past its end date. `today` is YYYY-MM-DD. */
export function isMedicineActive(medicine: Medicine, today: string): boolean {
  return medicine.stoppedAt === null && (medicine.endDate === null || medicine.endDate >= today);
}

/** Active medicines first, then the stopped ones. Each group is in alphabetical order. */
export function sortMedicines(medicines: readonly Medicine[], today: string): Medicine[] {
  return [...medicines].sort((a, b) => {
    const activeDifference = Number(isMedicineActive(b, today)) - Number(isMedicineActive(a, today));
    return activeDifference !== 0 ? activeDifference : a.name.localeCompare(b.name);
  });
}

/** One line about the dates: "Every day from Oct 29, 2026 until Nov 5, 2026", or why it stopped. */
export function medicineDatesText(medicine: Medicine, today: string): string {
  if (medicine.stoppedAt !== null) return `Stopped on ${formatDateKey(dayKey(new Date(medicine.stoppedAt)))}`;
  if (medicine.endDate !== null && medicine.endDate < today) return `Ended on ${formatDateKey(medicine.endDate)}`;
  const from = `Every day from ${formatDateKey(medicine.startDate)}`;
  return medicine.endDate ? `${from} until ${formatDateKey(medicine.endDate)}` : from;
}
