/**
 * Where the login session is kept between app launches.
 * The shape matches what Supabase expects, but nothing here is Supabase-specific.
 */
export interface ISessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
