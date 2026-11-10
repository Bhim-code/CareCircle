import {
  DEFAULT_PREFERENCES,
  SNOOZE_CHOICES,
  SYNCED_FIELDS,
  type SyncedPreferences,
  type UserPreferences,
} from '../domain/entities/UserPreferences';
import type { IPreferencesSync } from '../domain/services/IPreferencesSync';

/** The storage key for one person's settings. */
export function preferencesKey(userId: string): string {
  return `carecircle.preferences.${userId}`;
}

/** The marker for "a change on this phone has not reached the server yet". */
export function preferencesDirtyKey(userId: string): string {
  return `carecircle.preferences.dirty.${userId}`;
}

/** Only the part of the settings the server keeps. */
export function syncedPart(preferences: UserPreferences): SyncedPreferences {
  return {
    largerText: preferences.largerText,
    reminderNotifications: preferences.reminderNotifications,
    missedDoseEmail: preferences.missedDoseEmail,
    missedDoseCall: preferences.missedDoseCall,
    alarmSound: preferences.alarmSound,
    alarmVibration: preferences.alarmVibration,
    snoozeMinutes: preferences.snoozeMinutes,
  };
}

/**
 * The settings with the server's part put in. Anything the server leaves out, or sends as
 * something the app does not offer (a snooze length that is not in the list), stays as it is
 * on the phone.
 */
export function withSynced(preferences: UserPreferences, synced: SyncedPreferences): UserPreferences {
  const snooze = synced.snoozeMinutes;
  return {
    ...preferences,
    largerText: synced.largerText,
    reminderNotifications: synced.reminderNotifications,
    missedDoseEmail: synced.missedDoseEmail,
    missedDoseCall: synced.missedDoseCall,
    alarmSound: synced.alarmSound ?? preferences.alarmSound,
    alarmVibration: synced.alarmVibration ?? preferences.alarmVibration,
    snoozeMinutes:
      snooze !== undefined && (SNOOZE_CHOICES as readonly number[]).includes(snooze) ? snooze : preferences.snoozeMinutes,
  };
}

/** True when a change touches something the server keeps. */
export function touchesSynced(change: Partial<UserPreferences>): boolean {
  return SYNCED_FIELDS.some((field) => field in change);
}

export type Reconciled =
  | { readonly status: 'synced'; readonly preferences: UserPreferences }
  /** The server could not be reached. Nothing changes, and the phone's choices stay as they are. */
  | { readonly status: 'offline' };

/**
 * Brings the phone and the server together. If the person changed something on this phone that
 * the server has not heard of ("dirty"), the phone wins and is sent. Otherwise the server wins,
 * which is how a new phone gets the person's settings. Never throws.
 */
export async function reconcile(
  sync: IPreferencesSync,
  local: UserPreferences,
  dirty: boolean,
): Promise<Reconciled> {
  try {
    const synced = dirty ? await sync.push(syncedPart(local)) : await sync.fetch();
    return { status: 'synced', preferences: withSynced(local, synced) };
  } catch {
    return { status: 'offline' };
  }
}

/**
 * Turns whatever was stored into valid settings. Unknown or wrongly typed
 * fields fall back to the default, so old or damaged data never breaks the app.
 */
export function normalizePreferences(raw: unknown): UserPreferences {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFERENCES;
  const data = raw as Record<string, unknown>;
  const pick = (
    field: Exclude<keyof UserPreferences, 'snoozeMinutes'>,
  ): boolean =>
    typeof data[field] === 'boolean' ? (data[field] as boolean) : DEFAULT_PREFERENCES[field];
  const snooze = (SNOOZE_CHOICES as readonly unknown[]).includes(data.snoozeMinutes)
    ? (data.snoozeMinutes as number)
    : DEFAULT_PREFERENCES.snoozeMinutes;

  return {
    largerText: pick('largerText'),
    reminderNotifications: pick('reminderNotifications'),
    alarmSound: pick('alarmSound'),
    alarmVibration: pick('alarmVibration'),
    snoozeMinutes: snooze,
    missedDoseEmail: pick('missedDoseEmail'),
    missedDoseCall: pick('missedDoseCall'),
  };
}

/** Reads a stored JSON string safely. */
export function parsePreferences(stored: string | null): UserPreferences {
  if (stored === null) return DEFAULT_PREFERENCES;
  try {
    return normalizePreferences(JSON.parse(stored));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** How much bigger text is drawn when "Larger text" is on. */
export const LARGER_TEXT_SCALE = 1.25;

export function textScaleFor(preferences: UserPreferences): number {
  return preferences.largerText ? LARGER_TEXT_SCALE : 1;
}
