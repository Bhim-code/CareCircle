import type { AuthUser } from '../entities/AuthUser';
import type { Role } from '../entities/Role';

export interface SignUpInput {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly role: Role;
}

export interface SignUpResult {
  /** The new user, when they are signed in straight away. */
  readonly user: AuthUser | null;
  /** True when the person must open a link in their email before signing in. */
  readonly needsEmailConfirmation: boolean;
}

export type Unsubscribe = () => void;

/**
 * Everything the app needs from an authentication backend.
 * Implementations: SupabaseAuthService (real) and DemoAuthService (offline).
 * Every method rejects with AuthError.
 */
export interface IAuthService {
  getCurrentUser(): Promise<AuthUser | null>;
  signUp(input: SignUpInput): Promise<SignUpResult>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  /** Called whenever the signed-in user changes (sign in, sign out, expiry). */
  onAuthChange(listener: (user: AuthUser | null) => void): Unsubscribe;
}
