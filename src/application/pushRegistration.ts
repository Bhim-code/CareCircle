import type { IPushTokenService } from '../domain/services/IPushTokenService';
import type { IPushTokenSource } from '../domain/services/IPushTokenSource';
import type { IPushTokenStore } from '../domain/services/IPushTokenStore';

export interface PushDeps {
  readonly source: IPushTokenSource;
  readonly server: IPushTokenService;
  readonly store: IPushTokenStore;
}

/** What registering found out. Nothing here is an error: the app carries on whichever it is. */
export type PushStatus =
  /** The server knows this phone's token. */
  | 'registered'
  /** The person has not allowed notifications. */
  | 'not_allowed'
  /** This phone cannot get a token. */
  | 'unavailable'
  /** The server could not be reached. It will be tried again later. */
  | 'offline';

/** How long signing out waits for the server before it goes on without. */
export const UNREGISTER_TIMEOUT_MS = 3000;

/** How often the app registers again while it stays open, in milliseconds. */
export const PUSH_REGISTER_INTERVAL_MS = 6 * 60 * 60_000;

/** Waits for a promise, but never longer than the limit, and never throws. */
async function bestEffort(work: Promise<unknown>, limitMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, limitMs);
  });
  try {
    await Promise.race([work.then(() => undefined, () => undefined), limit]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Gives the server this phone's token so it can send the person notifications. Safe to call
 * as often as wanted: the server keeps one row per token. Never throws.
 */
export async function registerPush(deps: PushDeps, userId: string): Promise<PushStatus> {
  const previous = await deps.store.get(userId).catch(() => null);
  const result = await deps.source.getToken().catch(
    () => ({ kind: 'unavailable', reason: 'failed' }) as const,
  );

  if (result.kind === 'denied') {
    // Notifications were switched off in the phone's settings: stop the server sending any.
    if (previous) await unregisterPush(deps, userId);
    return 'not_allowed';
  }
  if (result.kind === 'unavailable') return 'unavailable';

  try {
    await deps.server.register(result.token);
  } catch {
    return 'offline';
  }
  await deps.store.set(userId, result.token).catch(() => undefined);
  // The phone got a new token: the old one is no longer this phone.
  if (previous && previous !== result.token) {
    await bestEffort(deps.server.unregister(previous), UNREGISTER_TIMEOUT_MS);
  }
  return 'registered';
}

/**
 * Takes this phone's token back from the server, so it stops getting this person's
 * notifications (call it before signing out, while the sign-in still works). Waits only a few
 * seconds and never throws: if the server cannot be reached, the next person who signs in on
 * this phone takes the token over anyway.
 */
export async function unregisterPush(
  deps: Pick<PushDeps, 'server' | 'store'>,
  userId: string,
  limitMs: number = UNREGISTER_TIMEOUT_MS,
): Promise<void> {
  const token = await deps.store.get(userId).catch(() => null);
  if (!token) return;
  await bestEffort(deps.server.unregister(token), limitMs);
  await deps.store.clear(userId).catch(() => undefined);
}
