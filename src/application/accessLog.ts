import type { AccessView } from '../domain/entities/AccessView';

const ACTIONS: Readonly<Record<string, string>> = {
  'entries.list': 'Read your care notes',
  'documents.list': 'Opened your health documents',
  'documents.upload': 'Added a health document',
  'tasks.list': 'Looked at your care tasks',
  'tasks.complete': 'Marked a care task as done',
  'tasks.extra': 'Added an extra care task',
  'tasks.plan': 'Changed your care plan',
  'profile.view': 'Looked at your profile',
  'patient.view': 'Looked at your details',
  'role.assign': 'Changed your account type',
  'permissions.grant': 'Changed what you are allowed to do',
  'user.activate': 'Turned your account on',
  'user.deactivate': 'Turned your account off',
  'user.company': 'Changed your company',
};

/** What was done, in plain words. A code the app does not know gets a safe general sentence. */
export function describeAction(action: string): string {
  return ACTIONS[action] ?? 'Looked at your information';
}

const ROLES: Readonly<Record<string, string>> = {
  patient: 'Patient',
  caregiver: 'Caregiver',
  supervisor: 'Supervisor',
  admin: 'Administrator',
};

/** The viewer's role as a word a person would say. */
export function describeRole(role: string): string {
  return ROLES[role] ?? 'Staff member';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Today", "Yesterday" or a date such as "March 3" (with the year when it is not this year). */
export function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Earlier';
  const days = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const base = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base}, ${date.getFullYear()}`;
}

/** The time of day, such as "2:05 PM". Empty when the date cannot be read. */
export function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}

export interface AccessDay {
  readonly label: string;
  readonly views: readonly AccessView[];
}

/** Groups views by day, newest first, keeping each day's views newest first. */
export function groupByDay(views: readonly AccessView[], now: Date): readonly AccessDay[] {
  const sorted = [...views].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || 0);
  const days: { label: string; views: AccessView[] }[] = [];
  for (const view of sorted) {
    const label = dayLabel(view.at, now);
    const last = days[days.length - 1];
    if (last && last.label === label) last.views.push(view);
    else days.push({ label, views: [view] });
  }
  return days;
}

/** A message for the screen when loading failed. */
export function describeAccessLogError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && typeof (error as Record<string, unknown>).code === 'string'
      ? ((error as Record<string, unknown>).code as string)
      : '';
  if (code === 'network' || code === 'timeout') return 'Cannot reach the server. Check your connection and try again.';
  if (code === 'session_expired' || code === 'unauthenticated') return 'Your sign-in has ended. Please sign in again.';
  if (code === 'forbidden') return 'Only patients can see who has viewed their records.';
  return 'We could not load this list. Please try again.';
}
