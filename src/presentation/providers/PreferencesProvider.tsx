import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { textScaleFor } from '../../application/preferences';
import { DEFAULT_PREFERENCES, type UserPreferences } from '../../domain/entities/UserPreferences';
import type { IPreferencesStore } from '../../domain/services/IPreferencesStore';
import { useAuth } from './AuthProvider';

export interface PreferencesContextValue {
  readonly preferences: UserPreferences;
  /** 1 normally, larger when "Larger text" is on. */
  readonly textScale: number;
  /** True when the last attempt to save a change failed. */
  readonly saveFailed: boolean;
  update(change: Partial<UserPreferences>): void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

interface PreferencesProviderProps {
  /** Injected, so tests can replace the real storage. */
  store: IPreferencesStore;
  children: ReactNode;
}

/** Loads the signed-in person's settings and saves each change as it is made. */
export function PreferencesProvider({ store, children }: PreferencesProviderProps) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [saveFailed, setSaveFailed] = useState(false);
  const latest = useRef(preferences);
  latest.current = preferences;

  useEffect(() => {
    let active = true;
    setPreferences(DEFAULT_PREFERENCES);
    setSaveFailed(false);
    if (userId) {
      store
        .load(userId)
        .then((loaded) => active && setPreferences(loaded))
        .catch(() => undefined); // Unreadable settings: keep the defaults.
    }
    return () => {
      active = false;
    };
  }, [store, userId]);

  const update = useCallback(
    (change: Partial<UserPreferences>) => {
      if (!userId) return;
      const next = { ...latest.current, ...change };
      latest.current = next;
      setPreferences(next);
      setSaveFailed(false);
      store.save(userId, next).catch(() => setSaveFailed(true));
    },
    [store, userId],
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({ preferences, textScale: textScaleFor(preferences), saveFailed, update }),
    [preferences, saveFailed, update],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('usePreferences must be used inside <PreferencesProvider>.');
  return context;
}

/** The text scale, or 1 on screens outside the provider (such as sign-in). */
export function useTextScale(): number {
  return useContext(PreferencesContext)?.textScale ?? 1;
}
