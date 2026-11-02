import type { AuthUser } from '../../domain/entities/AuthUser';
import { isRole } from '../../domain/entities/Role';
import { AuthError } from '../../domain/errors/AuthError';
import type {
  IAuthService,
  SignUpInput,
  SignUpResult,
  Unsubscribe,
} from '../../domain/services/IAuthService';
import { ApiClient } from './ApiClient';
import { ApiError } from './ApiError';
import { mapApiAuthError } from './mapApiError';

type Listener = (user: AuthUser | null) => void;

/** What the backend sends for a person (see UserOut in backend/app/schemas/auth.py). */
interface UserDto {
  id?: unknown;
  email?: unknown;
  name?: unknown;
  role?: unknown;
}

/** What sign-in and sign-up answer with (SessionOut). */
interface SessionDto {
  accessToken?: unknown;
  refreshToken?: unknown;
  user?: UserDto;
}

/** The phone's own time zone, such as America/St_Johns. Undefined if the phone will not say. */
export function deviceTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone !== '' ? zone : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sign-in, sign-up, sign-out and password reset against the CareCircle backend.
 * A drop-in replacement for SupabaseAuthService and DemoAuthService: every method
 * rejects with AuthError, so no screen needs to change.
 */
export class HttpAuthService implements IAuthService {
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly api: ApiClient,
    private readonly timeZone: () => string | undefined = deviceTimeZone,
  ) {
    // The backend refused to renew the sign-in (for example, it was ended on another device).
    api.onSessionExpired(() => this.announce(null));
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    if (!(await this.api.hasSession())) return null;
    try {
      const me = await this.api.get<UserDto>('/me');
      return this.toAuthUser(me);
    } catch (error) {
      // The client already forgot the tokens and told the listeners.
      if (error instanceof ApiError && (error.code === 'session_expired' || error.status === 401)) {
        return null;
      }
      // No signal at launch: keep the tokens so the next launch can still sign in by itself.
      throw mapApiAuthError(error);
    }
  }

  async signUp(input: SignUpInput): Promise<SignUpResult> {
    const timezone = this.timeZone();
    const session = await this.call<SessionDto>('/auth/sign-up', {
      name: input.name.trim(),
      email: input.email.trim(),
      password: input.password,
      role: input.role,
      ...(timezone ? { timezone } : {}),
    });
    const user = await this.start(session);
    // The backend signs the person in straight away: there is no email to confirm.
    return { user, needsEmailConfirmation: false };
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    const session = await this.call<SessionDto>('/auth/sign-in', { email: email.trim(), password });
    return this.start(session);
  }

  async signOut(): Promise<void> {
    // Tell the server so the tokens stop working, but never let a bad connection
    // keep the person signed in on this phone.
    try {
      if (await this.api.hasSession()) await this.api.post('/auth/sign-out');
    } catch {
      // Ignored on purpose: signing out on this phone must always work.
    }
    await this.api.forgetTokens();
    this.announce(null);
  }

  async requestPasswordReset(email: string): Promise<void> {
    await this.call<void>('/auth/password-reset', { email: email.trim() });
  }

  onAuthChange(listener: Listener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** A call made while signed out, with the backend's errors turned into AuthErrors. */
  private async call<T>(path: string, body: unknown): Promise<T> {
    try {
      return await this.api.post<T>(path, body, { auth: false });
    } catch (error) {
      throw mapApiAuthError(error);
    }
  }

  /** Keeps the tokens from a new session and tells the app who signed in. */
  private async start(session: SessionDto): Promise<AuthUser> {
    if (typeof session.accessToken !== 'string' || typeof session.refreshToken !== 'string') {
      throw new AuthError('unknown');
    }
    // Check the account before keeping anything, so a refused account leaves nothing behind.
    const user = this.toAuthUserOrRefuse(session.user);
    if (user instanceof AuthError) {
      await this.endRefusedSession(session.accessToken, session.refreshToken);
      throw user;
    }
    await this.api.saveTokens({ accessToken: session.accessToken, refreshToken: session.refreshToken });
    this.announce(user);
    return user;
  }

  /** The server made a session for an account the app cannot use. End it there as well. */
  private async endRefusedSession(accessToken: string, refreshToken: string): Promise<void> {
    try {
      await this.api.saveTokens({ accessToken, refreshToken });
      await this.api.post('/auth/sign-out');
    } catch {
      // Best effort. The tokens are forgotten below either way.
    }
    await this.api.forgetTokens();
  }

  private toAuthUser(dto: UserDto): AuthUser {
    const user = this.toAuthUserOrRefuse(dto);
    if (user instanceof AuthError) throw user;
    return user;
  }

  /**
   * Builds the person from the backend's answer. The role always comes from the
   * backend and is never guessed. Staff roles belong on the admin page.
   */
  private toAuthUserOrRefuse(dto: UserDto | undefined): AuthUser | AuthError {
    if (
      !dto ||
      typeof dto.id !== 'string' ||
      typeof dto.email !== 'string' ||
      typeof dto.name !== 'string'
    ) {
      return new AuthError('profile_unavailable');
    }
    if (dto.role === 'admin' || dto.role === 'supervisor') return new AuthError('staff_account');
    if (!isRole(dto.role)) return new AuthError('profile_unavailable');
    return { id: dto.id, email: dto.email, name: dto.name, role: dto.role };
  }

  private announce(user: AuthUser | null): void {
    for (const listener of [...this.listeners]) listener(user);
  }
}
