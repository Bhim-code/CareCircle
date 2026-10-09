import type { Role } from '../entities/Role';

/**
 * Development-only controls: pretend to be a user of any role without
 * signing in. Only exists in development builds.
 */
export interface IDevControls {
  readonly isDevMode: boolean;
  enableDevMode(role?: Role): void;
  switchDevRole(role: Role): void;
  /** Leaves dev mode and goes back to the real session, if there is one. */
  disableDevMode(): Promise<void>;
}
