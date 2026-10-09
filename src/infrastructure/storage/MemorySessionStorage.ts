import type { ISessionStorage } from '../../domain/services/ISessionStorage';

/** Keeps the session in memory only. Used by tests and the demo backend. */
export class MemorySessionStorage implements ISessionStorage {
  private readonly items = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.items.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.items.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.items.delete(key);
  }
}
