import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import type { ISessionStorage } from '../../domain/services/ISessionStorage';

export function createSupabaseClient(
  url: string,
  anonKey: string,
  storage: ISessionStorage,
): SupabaseClient {
  const client = createClient(url, anonKey, {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      // We are not a browser app that receives tokens in the page URL.
      detectSessionInUrl: false,
    },
  });

  // On phones the OS pauses timers in the background. Only refresh the
  // session while the app is in the foreground.
  if (Platform.OS !== 'web') {
    AppState.addEventListener('change', (state) => {
      if (state === 'active') client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    });
  }

  return client;
}
