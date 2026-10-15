/** The kinds of document a person can keep. "other" catches everything else. */
export const HEALTH_RECORD_CATEGORIES = [
  'prescription',
  'lab_report',
  'imaging',
  'discharge_summary',
  'other',
] as const;

export type HealthRecordCategory = (typeof HEALTH_RECORD_CATEGORIES)[number];

/**
 * One document in a person's health history. Only the details needed to list
 * it: the file itself is not part of this model yet.
 */
export interface HealthRecord {
  readonly id: string;
  readonly title: string;
  readonly category: HealthRecordCategory;
  /** The date on the document, as YYYY-MM-DD. Null when it is not known. */
  readonly recordedOn: string | null;
}
