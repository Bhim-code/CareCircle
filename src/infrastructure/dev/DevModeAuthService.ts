import type { AuthUser } from '../../domain/entities/AuthUser';
import type { Role } from '../../domain/entities/Role';
import type { IAuthService, SignUpInput, SignUpResult, Unsubscribe } from '../../domain/services/IAuthService';
import type { IDevControls } from '../../domain/services/IDevControls';

const DEV_USERS: Record<Role, AuthUser> = {
  patient: { id: 'dev-patient', email: 'patient@dev.local', name: 'Ana Patient (Dev)', role: 'patient' },
  caregiver: { id: 'dev-caregiver', email: 'caregiver@dev.local', name: 'Sam Caregiver (Dev)', role: 'caregiver' },
};

type Listener = (user: AuthUser | null) => void;

/**
 * Decorator: wraps any IAuthService and adds dev mode on top.
 * While dev mode is on, the app sees a fake user and ignores the real session.
 * Every other call passes straight through to the wrapped service.
 *
 * Only the composition root creates this, and only in development builds.
 */
export class DevModeAuthService implements IAuthService, IDevControls {
  private devUser: AuthUser | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly inner: IAuthService) {
    // Real session changes are hidden while a fake user is active.
    inner.onAuthChange((user) => {
      if (!this.devUser) this.emit(user);
    });
  }

  get isDevMode(): boolean {
    return this.devUser !== null;
  }

  enableDevMode(role: Role = 'patient'): void {
    this.devUser = DEV_USERS[role];
    this.emit(this.devUser);
  }

  switchDevRole(role: Role): void {
    if (!this.devUser) return;
    this.devUser = DEV_USERS[role];
    this.emit(this.devUser);
  }

  async disableDevMode(): Promise<void> {
    this.devUser = null;
    let real: AuthUser | null = null;
    try {
      real = await this.inner.getCurrentUser();
    } catch {
      real = null;
    }
    this.emit(real);
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.devUser ?? this.inner.getCurrentUser();
  }

  signUp(input: SignUpInput): Promise<SignUpResult> {
    return this.inner.signUp(input);
  }

  signIn(email: string, password: string): Promise<AuthUser> {
    return this.inner.signIn(email, password);
  }

  async signOut(): Promise<void> {
    this.devUser = null;
    await this.inner.signOut();
    this.emit(null);
  }

  requestPasswordReset(email: string): Promise<void> {
    return this.inner.requestPasswordReset(email);
  }

  onAuthChange(listener: Listener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(user: AuthUser | null): void {
    this.listeners.forEach((listener) => listener(user));
  }
}
