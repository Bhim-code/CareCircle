import {
  DEFAULT_PREFERENCES,
  type UserPreferences,
} from '../domain/entities/UserPreferences';

/** The storage key for one person's settings. */
export function preferencesKey(userId: string): string {
  return `carecircle.preferences.${userId}`;
}

/**
 * Turns whatever was stored into valid settings. Unknown or wrongly typed
 * fields fall back to the default, so old or damaged data never breaks the app.
 */
export function normalizePreferences(raw: unknown): UserPreferences {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFERENCES;
  const data = raw as Record<string, unknown>;
  const pick = (field: keyof UserPreferences): boolean =>
    typeof data[field] === 'boolean' ? (data[field] as boolean) : DEFAULT_PREFERENCES[field];

  return {
    largerText: pick('largerText'),
    reminderNotifications: pick('reminderNotifications'),
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
