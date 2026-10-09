import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { AuthUser } from '../../domain/entities/AuthUser';
import { AuthError } from '../../domain/errors/AuthError';
import type {
  IAuthService,
  SignUpInput,
  SignUpResult,
  Unsubscribe,
} from '../../domain/services/IAuthService';
import { mapSupabaseError } from './mapSupabaseError';
import { toAuthUser, type ProfileRow } from './profileMapper';

/** Adapter: makes Supabase look like the app's IAuthService. */
export class SupabaseAuthService implements IAuthService {
  constructor(private readonly client: SupabaseClient) {}

  async getCurrentUser(): Promise<AuthUser | null> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw mapSupabaseError(error);
    return data.session ? this.loadUser(data.session.user) : null;
  }

  async signUp(input: SignUpInput): Promise<SignUpResult> {
    const { data, error } = await this.client.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      // The database trigger reads these to create the profile row.
      options: { data: { name: input.name.trim(), role: input.role } },
    });
    if (error) throw mapSupabaseError(error);

    // With email confirmation on, Supabase answers an existing address with a
    // user that has no identities, instead of an error. Treat it as "taken".
    if (data.user && data.user.identities?.length === 0) {
      throw new AuthError('email_taken');
    }

    if (!data.session || !data.user) {
      return { user: null, needsEmailConfirmation: true };
    }
    return { user: await this.loadUser(data.user), needsEmailConfirmation: false };
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    const { data, error } = await this.client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw mapSupabaseError(error);
    return this.loadUser(data.user);
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw mapSupabaseError(error);
  }

  async requestPasswordReset(email: string): Promise<void> {
    // No redirectTo yet: the reset link opens the Site URL set in Supabase.
    // A "choose a new password" screen is the next step for this feature.
    const { error } = await this.client.auth.resetPasswordForEmail(email.trim());
    if (error) throw mapSupabaseError(error);
  }

  onAuthChange(listener: (user: AuthUser | null) => void): Unsubscribe {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      // Supabase warns against calling its own API inside this callback,
      // so hand the work to the next tick.
      setTimeout(async () => {
        if (!session) {
          listener(null);
          return;
        }
        try {
          listener(await this.loadUser(session.user));
        } catch {
          listener(null);
        }
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  }

  private async loadUser(user: User): Promise<AuthUser> {
    const { data, error } = await this.client
      .from('profiles')
      .select('id, name, role')
      .eq('id', user.id)
      .single<ProfileRow>();
    if (error || !data) throw new AuthError('profile_unavailable');
    return toAuthUser(data, user.email ?? '');
  }
}
