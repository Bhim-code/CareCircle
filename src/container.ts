import { env, isSupabaseConfigured } from './config/env';
import type { IAuthService } from './domain/services/IAuthService';
import type { IDevControls } from './domain/services/IDevControls';
import type { IHealthRecordService } from './domain/services/IHealthRecordService';
import type { IPreferencesStore } from './domain/services/IPreferencesStore';
import type { IRecordEntryService } from './domain/services/IRecordEntryService';
import type { IReminderService } from './domain/services/IReminderService';
import { DevModeAuthService } from './infrastructure/dev/DevModeAuthService';
import { DEMO_ACCOUNTS, DemoAuthService, type DemoAccount } from './infrastructure/demo/DemoAuthService';
import { DemoHealthRecordService } from './infrastructure/demo/DemoHealthRecordService';
import { DemoRecordEntryService } from './infrastructure/demo/DemoRecordEntryService';
import { DemoReminderService } from './infrastructure/demo/DemoReminderService';
import { AsyncPreferencesStore } from './infrastructure/storage/AsyncPreferencesStore';
import { AsyncSessionStorage } from './infrastructure/storage/AsyncSessionStorage';
import { EmptyRecordEntryService } from './infrastructure/supabase/EmptyRecordEntryService';
import { EmptyReminderService } from './infrastructure/supabase/EmptyReminderService';
import { createSupabaseClient } from './infrastructure/supabase/createSupabaseClient';
import { EmptyHealthRecordService } from './infrastructure/supabase/EmptyHealthRecordService';
import { SupabaseAuthService } from './infrastructure/supabase/SupabaseAuthService';

export interface Container {
  readonly authService: IAuthService;
  /** True when running on the in-memory backend. Always false in release builds. */
  readonly isDemo: boolean;
  readonly demoAccounts: readonly DemoAccount[];
  /** Present only in development builds. Always null in release builds. */
  readonly devControls: IDevControls | null;
}

/** True when the in-memory demo backend should be used. Never true in a release build. */
function shouldUseDemo(): boolean {
  return __DEV__ && (env.demoMode || !isSupabaseConfigured);
}

/**
 * The one place that decides which concrete classes the app uses.
 * Everything else depends on interfaces and receives these objects.
 *
 * The demo backend is only ever chosen in development builds (__DEV__),
 * so a release build can never fall back to it by accident.
 */
export function createContainer(): Container {
  const useDemo = shouldUseDemo();

  let authService: IAuthService;
  if (useDemo) {
    authService = new DemoAuthService();
  } else {
    if (!isSupabaseConfigured) {
      throw new Error(
        'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. See .env.example.',
      );
    }
    const client = createSupabaseClient(
      env.supabaseUrl,
      env.supabaseAnonKey,
      new AsyncSessionStorage(),
    );
    authService = new SupabaseAuthService(client);
  }

  // Dev mode wraps whichever service was chosen. Release builds skip it entirely.
  let devControls: IDevControls | null = null;
  if (__DEV__) {
    const wrapped = new DevModeAuthService(authService);
    authService = wrapped;
    devControls = wrapped;
  }

  return {
    authService,
    isDemo: useDemo,
    demoAccounts: useDemo ? DEMO_ACCOUNTS : [],
    devControls,
  };
}

/**
 * Per-person settings (larger text, notification choices) are kept on the device.
 * Built separately from the main container because only the signed-in part of
 * the app needs them.
 */
export function createPreferencesStore(): IPreferencesStore {
  return new AsyncPreferencesStore();
}

/**
 * Reminders follow the same choice as the rest of the app: made-up demo
 * reminders in development, otherwise the real backend (not built yet, so empty).
 */
export function createReminderService(): IReminderService {
  return shouldUseDemo() ? new DemoReminderService() : new EmptyReminderService();
}

/**
 * Health records make the same choice: made-up demo records in development,
 * otherwise the real backend (not built yet, so empty).
 */
export function createHealthRecordService(): IHealthRecordService {
  return shouldUseDemo() ? new DemoHealthRecordService() : new EmptyHealthRecordService();
}

/**
 * Written records (incidents, medical, behavioural, medication notes) make the
 * same choice: made-up demo entries in development, otherwise the real backend
 * (not built yet, so empty).
 */
export function createRecordEntryService(): IRecordEntryService {
  return shouldUseDemo() ? new DemoRecordEntryService() : new EmptyRecordEntryService();
}
