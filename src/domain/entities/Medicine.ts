/** A medicine a patient takes, with the times of day to take it. */
export interface Medicine {
  readonly id: string;
  readonly name: string;
  /** Times of day, 24-hour "HH:MM", earliest first. The same times every day. */
  readonly times: readonly string[];
  /** First day, as YYYY-MM-DD. */
  readonly startDate: string;
  /** Last day, as YYYY-MM-DD, or null when it carries on. */
  readonly endDate: string | null;
  /** When the patient stopped it (an ISO date-time), or null while it is still taken. */
  readonly stoppedAt: string | null;
}

/** What the patient fills in to add a medicine. */
export interface MedicineInput {
  readonly name: string;
  readonly times: readonly string[];
  readonly startDate: string;
  readonly endDate: string | null;
}
