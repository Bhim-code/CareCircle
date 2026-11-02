/**
 * Reads build-time settings. Expo only inlines EXPO_PUBLIC_* variables when
 * they are written out in full like this, so do not refactor to dynamic access.
 */
export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  demoMode: process.env.EXPO_PUBLIC_DEMO_MODE === 'true',
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? '',
} as const;

export const isSupabaseConfigured = env.supabaseUrl !== '' && env.supabaseAnonKey !== '';

/** True when the address of the CareCircle backend is set. */
export const isApiConfigured = env.apiUrl.trim() !== '';
