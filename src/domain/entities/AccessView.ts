/** Someone who looked at a patient's information. */
export interface Viewer {
  readonly id: string;
  readonly name: string;
  /** For example "caregiver", "supervisor" or "admin". */
  readonly role: string;
}

/** One time someone looked at (or changed) a patient's information. */
export interface AccessView {
  /** When it happened, as an ISO date and time. */
  readonly at: string;
  readonly viewer: Viewer;
  /** The backend's short code for what was done, for example "entries.list". */
  readonly action: string;
}
