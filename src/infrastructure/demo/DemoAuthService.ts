import type { AuthUser } from '../../domain/entities/AuthUser';
import { AuthError } from '../../domain/errors/AuthError';
import type {
  IAuthService,
  SignUpInput,
  SignUpResult,
  Unsubscribe,
} from '../../domain/services/IAuthService';

interface Account {
  user: AuthUser;
  password: string;
}

export interface DemoAccount {
  readonly label: string;
  readonly email: string;
  readonly password: string;
}

export const DEMO_PASSWORD = 'demo1234';

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { label: 'Patient', email: 'patient@demo.test', password: DEMO_PASSWORD },
  { label: 'Caregiver', email: 'caregiver@demo.test', password: DEMO_PASSWORD },
];

type Listener = (user: AuthUser | null) => void;

/**
 * An in-memory IAuthService for running the app with no server. It is a
 * drop-in replacement for SupabaseAuthService, so every screen behaves the
 * same either way. Accounts are lost when the app reloads.
 */
export class DemoAuthService implements IAuthService {
  private readonly accounts = new Map<string, Account>();
  private readonly listeners = new Set<Listener>();
  private current: AuthUser | null = null;

  constructor(private readonly latencyMs = 300) {
    this.seed('Ana Patient', 'patient@demo.test', 'patient');
    this.seed('Sam Caregiver', 'caregiver@demo.test', 'caregiver');
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.current;
  }

  async signUp(input: SignUpInput): Promise<SignUpResult> {
    await this.pause();
    const email = normalise(input.email);
    if (this.accounts.has(email)) throw new AuthError('email_taken');

    const user: AuthUser = {
      id: `demo-${this.accounts.size + 1}`,
      email,
      name: input.name.trim(),
      role: input.role,
    };
    this.accounts.set(email, { user, password: input.password });
    this.setCurrent(user);
    return { user, needsEmailConfirmation: false };
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    await this.pause();
    const account = this.accounts.get(normalise(email));
    if (!account || account.password !== password) {
      throw new AuthError('invalid_credentials');
    }
    this.setCurrent(account.user);
    return account.user;
  }

  async signOut(): Promise<void> {
    this.setCurrent(null);
  }

  async requestPasswordReset(_email: string): Promise<void> {
    await this.pause();
  }

  onAuthChange(listener: Listener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private seed(name: string, email: string, role: AuthUser['role']): void {
    const user: AuthUser = { id: `demo-${email}`, email, name, role };
    this.accounts.set(email, { user, password: DEMO_PASSWORD });
  }

  private setCurrent(user: AuthUser | null): void {
    this.current = user;
    this.listeners.forEach((listener) => listener(user));
  }

  private pause(): Promise<void> {
    return this.latencyMs > 0
      ? new Promise((resolve) => setTimeout(resolve, this.latencyMs))
      : Promise.resolve();
  }
}

function normalise(email: string): string {
  return email.trim().toLowerCase();
}
