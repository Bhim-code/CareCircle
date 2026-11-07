import type { PushTokenResult } from '../entities/PushToken';

/** Asks this phone for its push token. Never throws: every problem is a PushTokenResult. */
export interface IPushTokenSource {
  getToken(): Promise<PushTokenResult>;
}
