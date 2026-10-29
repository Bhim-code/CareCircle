import type { ISessionStorage } from '../../domain/services/ISessionStorage';

const KEY_PREFIX = 'carecircle.skipped.';
/** Old entries are dropped past this many. A dose is only skipped on the day it is due. */
export const MAX_REMEMBERED_SKIPS = 300;

/**
 * Remembers which doses this person pressed "Skip" on, on this phone.
 *
 * Temporary: the backend has no "skip" call yet (it only knows "taken"), so the skip
 * is kept here, per person. Once the backend can record a skip, the reminder service
 * should send it there and this store can go. Until then the server does not know about
 * a skip, so it may still send a missed-dose alert to the caregiver for that dose.
 */
export class SkippedDoseStore {
  private readonly ids = new Map<string, Promise<string[]>>();
  /** Saves wait in line, so two skips at the same moment cannot overwrite each other. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly storage: ISessionStorage,
    private readonly prefix: string = KEY_PREFIX,
  ) {}

  /** The doses this person has skipped. */
  async skippedBy(userId: string): Promise<ReadonlySet<string>> {
    return new Set(await this.load(userId));
  }

  add(userId: string, reminderId: string): Promise<void> {
    const saved = this.queue.then(() => this.save(userId, reminderId));
    this.queue = saved.catch(() => undefined);
    return saved;
  }

  private async save(userId: string, reminderId: string): Promise<void> {
    const current = await this.load(userId);
    if (current.includes(reminderId)) return;
    const next = [...current, reminderId].slice(-MAX_REMEMBERED_SKIPS);
    // Update the copy in memory first, so a second skip right after this one sees it.
    this.ids.set(userId, Promise.resolve(next));
    try {
      await this.storage.setItem(this.prefix + userId, JSON.stringify(next));
    } catch (error) {
      this.ids.set(userId, Promise.resolve(current));
      throw error;
    }
  }

  private load(userId: string): Promise<string[]> {
    let loading = this.ids.get(userId);
    if (!loading) {
      loading = this.read(userId);
      this.ids.set(userId, loading);
    }
    return loading;
  }

  private async read(userId: string): Promise<string[]> {
    try {
      const raw = await this.storage.getItem(this.prefix + userId);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is string => typeof item === 'string');
    } catch {
      return [];
    }
  }
}
