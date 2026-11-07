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
import { AppState } from 'react-native';
import { reconcile, textScaleFor, touchesSynced } from '../../application/preferences';
import { DEFAULT_PREFERENCES, type UserPreferences } from '../../domain/entities/UserPreferences';
import type { IPreferencesStore } from '../../domain/services/IPreferencesStore';
import type { IPreferencesSync } from '../../domain/services/IPreferencesSync';
import { useAuth } from './AuthProvider';

export interface PreferencesContextValue {
  readonly preferences: UserPreferences;
  /** 1 normally, larger when "Larger text" is on. */
  readonly textScale: number;
  /** True when the last attempt to save a change failed. */
  readonly saveFailed: boolean;
  /** True when a change is saved on this phone but has not reached the server yet. */
  readonly syncPending: boolean;
  update(change: Partial<UserPreferences>): void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

interface PreferencesProviderProps {
  /** Injected, so tests can replace the real storage. */
  store: IPreferencesStore;
  /** Where the settings that follow the person to a new phone are kept. Null keeps everything on the phone. */
  sync?: IPreferencesSync | null;
  children: ReactNode;
}

/**
 * Loads the signed-in person's settings and saves each change as it is made. The phone's copy is
 * used at once, so the app opens with no connection. The server's copy is then brought in (a new
 * phone gets the person's settings), and a change made while offline is sent when the phone can
 * reach the server again.
 */
export function PreferencesProvider({ store, sync = null, children }: PreferencesProviderProps) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [saveFailed, setSaveFailed] = useState(false);
  const [syncPending, setSyncPending] = useState(false);
  const latest = useRef(preferences);
  latest.current = preferences;
  // Counts the person's changes, so a look at the server that began before a change cannot undo it.
  const changes = useRef(0);
  const syncing = useRef(false);
  const again = useRef(false);

  const runSync = useCallback(async () => {
    if (!sync || !userId) return;
    if (syncing.current) {
      again.current = true; // look once more when this one ends
      return;
    }
    syncing.current = true;
    try {
      do {
        again.current = false;
        const started = changes.current;
        const dirty = await store.isDirty(userId).catch(() => false);
        const result = await reconcile(sync, latest.current, dirty);
        if (result.status === 'offline') {
          setSyncPending(dirty);
        } else if (changes.current === started) {
          latest.current = result.preferences;
          setPreferences(result.preferences);
          setSyncPending(false);
          await store.save(userId, result.preferences).catch(() => undefined);
          await store.setDirty(userId, false).catch(() => undefined);
        } else {
          again.current = true; // the person changed something meanwhile: send that too
        }
      } while (again.current);
    } finally {
      syncing.current = false;
    }
  }, [store, sync, userId]);

  useEffect(() => {
    let active = true;
    setPreferences(DEFAULT_PREFERENCES);
    setSaveFailed(false);
    setSyncPending(false);
    if (userId) {
      store
        .load(userId)
        .then(async (loaded) => {
          if (!active) return;
          latest.current = loaded;
          setPreferences(loaded);
          setSyncPending(await store.isDirty(userId).catch(() => false));
          if (active) void runSync();
        })
        .catch(() => undefined); // Unreadable settings: keep the defaults.
    }
    return () => {
      active = false;
    };
  }, [store, userId, runSync]);

  // Look at the server again whenever the app comes back to the front.
  useEffect(() => {
    if (!sync || !userId) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void runSync();
    });
    return () => subscription.remove();
  }, [sync, userId, runSync]);

  const update = useCallback(
    (change: Partial<UserPreferences>) => {
      if (!userId) return;
      const next = { ...latest.current, ...change };
      latest.current = next;
      setPreferences(next);
      setSaveFailed(false);
      changes.current += 1;
      const saved = store.save(userId, next).catch(() => setSaveFailed(true));
      if (sync && touchesSynced(change)) {
        // Remember that the server has not heard of this yet, so a restart cannot lose it.
        setSyncPending(true);
        void saved.then(() => store.setDirty(userId, true)).then(() => runSync()).catch(() => undefined);
      }
    },
    [store, sync, userId, runSync],
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({ preferences, textScale: textScaleFor(preferences), saveFailed, syncPending, update }),
    [preferences, saveFailed, syncPending, update],
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
