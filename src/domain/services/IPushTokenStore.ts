/**
 * The push token this phone last gave the server for a person, so that signing out (or turning
 * notifications off) knows which one to take back. Kept per person.
 */
export interface IPushTokenStore {
  get(userId: string): Promise<string | null>;
  set(userId: string, token: string): Promise<void>;
  clear(userId: string): Promise<void>;
}
