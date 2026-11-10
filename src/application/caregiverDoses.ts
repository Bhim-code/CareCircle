import type { PatientDose } from '../domain/entities/PatientDose';

export interface PatientChoice {
  readonly id: string;
  readonly name: string;
}

/** Earliest first; the same time sorts by patient name, then medicine. */
export function sortDoses(doses: readonly PatientDose[]): PatientDose[] {
  return [...doses].sort(
    (a, b) =>
      a.scheduledAt.localeCompare(b.scheduledAt) ||
      a.patientName.localeCompare(b.patientName) ||
      a.medicineName.localeCompare(b.medicineName),
  );
}

/** The patients who have doses in the list, by name. */
export function patientsOf(doses: readonly PatientDose[]): PatientChoice[] {
  const seen = new Map<string, string>();
  for (const dose of doses) if (!seen.has(dose.patientId)) seen.set(dose.patientId, dose.patientName);
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** All doses, or only one patient's when a patient is picked. */
export function dosesFor(doses: readonly PatientDose[], patientId: string | null): readonly PatientDose[] {
  return patientId === null ? doses : doses.filter((dose) => dose.patientId === patientId);
}

/** A message for the screen when loading failed. */
export function describeDosesError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && typeof (error as Record<string, unknown>).code === 'string'
      ? ((error as Record<string, unknown>).code as string)
      : '';
  if (code === 'network' || code === 'timeout') return 'Cannot reach the server. Check your connection and try again.';
  if (code === 'session_expired' || code === 'unauthenticated') return 'Your sign-in has ended. Please sign in again.';
  return 'We could not load the doses. Please try again.';
}
