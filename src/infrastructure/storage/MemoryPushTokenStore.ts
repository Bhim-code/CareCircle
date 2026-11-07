import type { IPushTokenStore } from '../../domain/services/IPushTokenStore';

/** Keeps push tokens in memory only. Used by tests. */
export class MemoryPushTokenStore implements IPushTokenStore {
  private readonly items = new Map<string, string>();

  async get(userId: string): Promise<string | null> {
    return this.items.get(userId) ?? null;
  }

  async set(userId: string, token: string): Promise<void> {
    this.items.set(userId, token);
  }

  async clear(userId: string): Promise<void> {
    this.items.delete(userId);
  }
}
