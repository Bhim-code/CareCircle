import {
  HEALTH_RECORD_CATEGORIES,
  type HealthRecord,
  type HealthRecordCategory,
} from '../domain/entities/HealthRecord';

/** A category to filter by, or every category. */
export type RecordFilter = HealthRecordCategory | 'all';

const CATEGORY_LABELS: Record<HealthRecordCategory, string> = {
  prescription: 'Prescriptions',
  lab_report: 'Lab reports',
  imaging: 'Imaging / X-rays',
  discharge_summary: 'Discharge summaries',
  other: 'Other documents',
};

/** The category's name as shown to people, e.g. "Lab reports". */
export function categoryLabel(category: HealthRecordCategory): string {
  return CATEGORY_LABELS[category];
}

export function filterLabel(filter: RecordFilter): string {
  return filter === 'all' ? 'All' : categoryLabel(filter);
}

export const RECORD_FILTERS: readonly RecordFilter[] = ['all', ...HEALTH_RECORD_CATEGORIES];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Turns "2026-03-12" into "12 Mar 2026". Returns "No date" when the date is
 * missing or not a real calendar date, so a bad value never shows as "NaN".
 */
export function formatRecordDate(recordedOn: string | null): string {
  if (!recordedOn) return 'No date';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(recordedOn);
  if (!match) return 'No date';
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  const real =
    check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
  return real ? `${day} ${MONTHS[month - 1]} ${year}` : 'No date';
}

/** Newest first. Records with no date go last, then by title so the order is stable. */
export function sortRecords(records: readonly HealthRecord[]): HealthRecord[] {
  return [...records].sort((a, b) => {
    if (a.recordedOn && b.recordedOn && a.recordedOn !== b.recordedOn) {
      return a.recordedOn < b.recordedOn ? 1 : -1;
    }
    if (a.recordedOn && !b.recordedOn) return -1;
    if (!a.recordedOn && b.recordedOn) return 1;
    return a.title.localeCompare(b.title);
  });
}

export function filterRecords(records: readonly HealthRecord[], filter: RecordFilter): HealthRecord[] {
  return filter === 'all' ? [...records] : records.filter((record) => record.category === filter);
}

/** How many records each filter would show, for the number on each chip. */
export function countByFilter(records: readonly HealthRecord[]): Record<RecordFilter, number> {
  const counts = { all: records.length } as Record<RecordFilter, number>;
  for (const category of HEALTH_RECORD_CATEGORIES) counts[category] = 0;
  for (const record of records) counts[record.category] += 1;
  return counts;
}

/** What to say when there is nothing to list. */
export function emptyMessageFor(filter: RecordFilter, totalRecords: number): string {
  if (totalRecords === 0) {
    return 'No health records yet. Your documents will appear here, organised by type and date.';
  }
  return `No ${filterLabel(filter).toLowerCase()} yet. Choose another type to see your other documents.`;
}
