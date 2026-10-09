import { env, isSupabaseConfigured } from './config/env';
import type { IAuthService } from './domain/services/IAuthService';
import type { IDevControls } from './domain/services/IDevControls';
import { DevModeAuthService } from './infrastructure/dev/DevModeAuthService';
import { DEMO_ACCOUNTS, DemoAuthService, type DemoAccount } from './infrastructure/demo/DemoAuthService';
import { AsyncSessionStorage } from './infrastructure/storage/AsyncSessionStorage';
import { createSupabaseClient } from './infrastructure/supabase/createSupabaseClient';
import { SupabaseAuthService } from './infrastructure/supabase/SupabaseAuthService';

export interface Container {
  readonly authService: IAuthService;
  /** True when running on the in-memory backend. Always false in release builds. */
  readonly isDemo: boolean;
  readonly demoAccounts: readonly DemoAccount[];
  /** Present only in development builds. Always null in release builds. */
  readonly devControls: IDevControls | null;
}

/**
 * The one place that decides which concrete classes the app uses.
 * Everything else depends on interfaces and receives these objects.
 *
 * The demo backend is only ever chosen in development builds (__DEV__),
 * so a release build can never fall back to it by accident.
 */
export function createContainer(): Container {
  const useDemo = __DEV__ && (env.demoMode || !isSupabaseConfigured);

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
