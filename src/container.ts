import { env, isApiConfigured, isSupabaseConfigured } from './config/env';
import { Platform } from 'react-native';
import type { IAlarmScheduler } from './domain/services/IAlarmScheduler';
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
import { NotifyKitAlarmScheduler } from './infrastructure/notifications/NotifyKitAlarmScheduler';
import { NoopAlarmScheduler } from './infrastructure/notifications/NoopAlarmScheduler';
import { AsyncPreferencesStore } from './infrastructure/storage/AsyncPreferencesStore';
import { ApiClient } from './infrastructure/http/ApiClient';
import { HttpAuthService } from './infrastructure/http/HttpAuthService';
import { HttpReminderService } from './infrastructure/http/HttpReminderService';
import { SkippedDoseStore } from './infrastructure/http/SkippedDoseStore';
import { TokenStore } from './infrastructure/http/TokenStore';
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
  return __DEV__ && (env.demoMode || (!isApiConfigured && !isSupabaseConfigured));
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
  } else if (isApiConfigured) {
    // The CareCircle backend (backend/). It wins over the older Supabase setup when both are set.
    authService = new HttpAuthService(createApiClient());
  } else {
    if (!isSupabaseConfigured) {
      throw new Error(
        'Missing EXPO_PUBLIC_API_URL (the CareCircle backend). See .env.example.',
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
 * reminders in development, the CareCircle backend when its address is set,
 * otherwise nothing (an empty list).
 */
export function createReminderService(): IReminderService {
  if (shouldUseDemo()) return new DemoReminderService();
  if (isApiConfigured) {
    return new HttpReminderService(createApiClient(), new SkippedDoseStore(new AsyncSessionStorage()));
  }
  return new EmptyReminderService();
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

/**
 * Alarms are set on the phone itself. The web has no such thing, so it gets a
 * scheduler that does nothing.
 */
export function createAlarmScheduler(): IAlarmScheduler {
  return Platform.OS === 'web' ? new NoopAlarmScheduler() : new NotifyKitAlarmScheduler();
}

let sharedApiClient: ApiClient | null = null;

/**
 * The one connection to the CareCircle backend. Every service that talks to the
 * backend gets this same object, because it makes sure only one token renewal runs
 * at a time. Use `api.onSessionExpired(...)` to react when the sign-in ends.
 */
export function createApiClient(): ApiClient {
  if (!isApiConfigured) {
    throw new Error('Missing EXPO_PUBLIC_API_URL, the address of the backend. See .env.example.');
  }
  if (!sharedApiClient) {
    sharedApiClient = new ApiClient({
      baseUrl: env.apiUrl,
      tokens: new TokenStore(new AsyncSessionStorage()),
    });
  }
  return sharedApiClient;
}
