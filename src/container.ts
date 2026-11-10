import { env, isApiConfigured, isSupabaseConfigured } from './config/env';
import { Platform } from 'react-native';
import type { IAlarmScheduler } from './domain/services/IAlarmScheduler';
import type { IAuthService } from './domain/services/IAuthService';
import type { ICareLinkService } from './domain/services/ICareLinkService';
import type { ICareTaskService } from './domain/services/ICareTaskService';
import type { IFilePicker } from './domain/services/IFilePicker';
import type { IDevControls } from './domain/services/IDevControls';
import type { IHealthRecordService } from './domain/services/IHealthRecordService';
import type { IMedicineService } from './domain/services/IMedicineService';
import type { IPreferencesStore } from './domain/services/IPreferencesStore';
import type { IAccessLogService } from './domain/services/IAccessLogService';
import type { IPushEvents } from './domain/services/IPushEvents';
import type { IPreferencesSync } from './domain/services/IPreferencesSync';
import type { IProfileService } from './domain/services/IProfileService';
import type { IRecordEntryService } from './domain/services/IRecordEntryService';
import type { IReminderService } from './domain/services/IReminderService';
import { DevModeAuthService } from './infrastructure/dev/DevModeAuthService';
import { DEMO_ACCOUNTS, DemoAuthService, type DemoAccount } from './infrastructure/demo/DemoAuthService';
import { DemoProfileService } from './infrastructure/demo/DemoProfileService';
import { DemoCareLinkService } from './infrastructure/demo/DemoCareLinkService';
import { DemoCareTaskService } from './infrastructure/demo/DemoCareTaskService';
import { DemoHealthRecordService } from './infrastructure/demo/DemoHealthRecordService';
import { DemoMedicineService } from './infrastructure/demo/DemoMedicineService';
import { DemoRecordEntryService } from './infrastructure/demo/DemoRecordEntryService';
import { DemoReminderService } from './infrastructure/demo/DemoReminderService';
import { ExpoFilePicker } from './infrastructure/device/ExpoFilePicker';
import { NotifyKitAlarmScheduler } from './infrastructure/notifications/NotifyKitAlarmScheduler';
import { NoopAlarmScheduler } from './infrastructure/notifications/NoopAlarmScheduler';
import { DemoAccessLogService } from './infrastructure/demo/DemoAccessLogService';
import { EmptyAccessLogService } from './infrastructure/supabase/EmptyAccessLogService';
import { HttpAccessLogService } from './infrastructure/http/HttpAccessLogService';
import { ExpoPushEvents } from './infrastructure/notifications/ExpoPushEvents';
import { ExpoPushTokenSource } from './infrastructure/notifications/ExpoPushTokenSource';
import { AsyncPushTokenStore } from './infrastructure/storage/AsyncPushTokenStore';
import { HttpPushTokenService } from './infrastructure/http/HttpPushTokenService';
import { registerPush, unregisterPush, type PushStatus } from './application/pushRegistration';
import { AsyncPreferencesStore } from './infrastructure/storage/AsyncPreferencesStore';
import { ApiClient } from './infrastructure/http/ApiClient';
import { HttpAuthService } from './infrastructure/http/HttpAuthService';
import { HttpPreferencesSync } from './infrastructure/http/HttpPreferencesSync';
import { HttpProfileService } from './infrastructure/http/HttpProfileService';
import { HttpCareLinkService } from './infrastructure/http/HttpCareLinkService';
import { HttpCareTaskService } from './infrastructure/http/HttpCareTaskService';
import { HttpHealthRecordService } from './infrastructure/http/HttpHealthRecordService';
import { HttpRecordEntryService } from './infrastructure/http/HttpRecordEntryService';
import { HttpMedicineService } from './infrastructure/http/HttpMedicineService';
import { HttpReminderService } from './infrastructure/http/HttpReminderService';
import { TokenStore } from './infrastructure/http/TokenStore';
import { AsyncSessionStorage } from './infrastructure/storage/AsyncSessionStorage';
import { EmptyCareLinkService } from './infrastructure/supabase/EmptyCareLinkService';
import { EmptyCareTaskService } from './infrastructure/supabase/EmptyCareTaskService';
import { EmptyMedicineService } from './infrastructure/supabase/EmptyMedicineService';
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
  /** Stops notifications from the server to this phone. Null when there is nothing to stop. */
  readonly beforeSignOut: ((userId: string) => Promise<void>) | null;
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
    beforeSignOut: (userId) => createPushRegistry()?.unregister(userId) ?? Promise.resolve(),
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
 * Where the settings that should follow the person to a new phone are kept: the CareCircle
 * backend when its address is set. Null in demo mode or with no backend, where settings
 * stay on the phone only.
 */
export function createPreferencesSync(): IPreferencesSync | null {
  if (shouldUseDemo() || !isApiConfigured) return null;
  return new HttpPreferencesSync(createApiClient());
}

/** What the app does to be sent notifications from the server. */
export interface PushRegistry {
  /** Gives the server this phone's token (when the person has allowed notifications). */
  register(userId: string): Promise<PushStatus>;
  /** Takes the token back, so the phone stops getting this person's notifications. */
  unregister(userId: string): Promise<void>;
}

/**
 * Notifications from the server (such as "time for your medicine") need the backend. Null in
 * demo mode or with no backend address, where there is nothing to register with.
 */
let pushRegistry: PushRegistry | null | undefined;
export function createPushRegistry(): PushRegistry | null {
  if (pushRegistry === undefined) pushRegistry = buildPushRegistry();
  return pushRegistry;
}

function buildPushRegistry(): PushRegistry | null {
  if (shouldUseDemo() || !isApiConfigured) return null;
  const deps = {
    source: new ExpoPushTokenSource(),
    server: new HttpPushTokenService(createApiClient()),
    store: new AsyncPushTokenStore(),
  };
  return {
    register: (userId) => registerPush(deps, userId),
    unregister: (userId) => unregisterPush(deps, userId),
  };
}

/** What happens when a notification from the server is tapped. */
export function createPushEvents(): IPushEvents {
  return new ExpoPushEvents();
}

/** Changing the person's own details (their name). */
export function createProfileService(): IProfileService | null {
  if (shouldUseDemo()) return new DemoProfileService();
  if (isApiConfigured) return new HttpProfileService(createApiClient());
  return null;
}

/**
 * Reminders follow the same choice as the rest of the app: made-up demo
 * reminders in development, the CareCircle backend when its address is set,
 * otherwise nothing (an empty list).
 */
export function createReminderService(): IReminderService {
  if (shouldUseDemo()) return new DemoReminderService(300, sharedDemoMedicines());
  if (isApiConfigured) {
    return new HttpReminderService(createApiClient());
  }
  return new EmptyReminderService();
}

let demoMedicines: DemoMedicineService | null = null;

/** In demo mode the reminders and the medicines must share one list, so adding a medicine adds its doses. */
function sharedDemoMedicines(): DemoMedicineService {
  demoMedicines ??= new DemoMedicineService();
  return demoMedicines;
}

/**
 * Medicines make the same choice: made-up demo medicines in development, the
 * CareCircle backend when its address is set, otherwise nothing.
 */
export function createMedicineService(): IMedicineService {
  if (shouldUseDemo()) return sharedDemoMedicines();
  if (isApiConfigured) return new HttpMedicineService(createApiClient());
  return new EmptyMedicineService();
}

/**
 * Care links (who looks after whom) make the same choice: made-up demo links in
 * development, the CareCircle backend when its address is set, otherwise nothing.
 */
export function createCareLinkService(): ICareLinkService {
  if (shouldUseDemo()) return new DemoCareLinkService();
  if (isApiConfigured) return new HttpCareLinkService(createApiClient());
  return new EmptyCareLinkService();
}

/** Who has viewed a patient's records: made-up views in development, the backend when its address is set. */
export function createAccessLogService(): IAccessLogService {
  if (shouldUseDemo()) return new DemoAccessLogService();
  if (isApiConfigured) return new HttpAccessLogService(createApiClient());
  return new EmptyAccessLogService();
}

/**
 * Daily care tasks make the same choice: made-up demo tasks in development, the
 * CareCircle backend when its address is set, otherwise nothing.
 */
export function createCareTaskService(): ICareTaskService {
  if (shouldUseDemo()) return new DemoCareTaskService();
  if (isApiConfigured) return new HttpCareTaskService(createApiClient());
  return new EmptyCareTaskService();
}

/**
 * Health documents make the same choice: made-up demo documents in development,
 * the CareCircle backend when its address is set, otherwise nothing.
 */
export function createHealthRecordService(): IHealthRecordService {
  if (shouldUseDemo()) return new DemoHealthRecordService();
  if (isApiConfigured) return new HttpHealthRecordService(createApiClient());
  return new EmptyHealthRecordService();
}

/** Taking or choosing a photo, and choosing a PDF, on the phone. */
export function createFilePicker(): IFilePicker {
  return new ExpoFilePicker();
}

/**
 * Written records (incidents, medical, behavioural, medication notes) make the
 * same choice: made-up demo entries in development, the CareCircle backend when
 * its address is set, otherwise nothing.
 */
export function createRecordEntryService(): IRecordEntryService {
  if (shouldUseDemo()) return new DemoRecordEntryService();
  if (isApiConfigured) return new HttpRecordEntryService(createApiClient());
  return new EmptyRecordEntryService();
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
