import { AuthError, type AuthErrorCode } from '../domain/errors/AuthError';

const MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials: 'That email and password do not match. Check them and try again.',
  email_not_confirmed: 'Confirm your email first. Open the link we sent you, then sign in.',
  email_taken: 'An account with that email already exists. Sign in instead.',
  invalid_email: 'Enter an email address like name@example.com.',
  weak_password: 'Choose a longer password with a mix of letters and numbers.',
  rate_limited: 'Too many attempts. Wait a minute, then try again.',
  network: 'Cannot reach the server. Check your connection and try again.',
  profile_unavailable: 'Your account loaded without its profile. Try again, or contact support.',
  unknown: 'Something went wrong. Try again in a moment.',
};

/** Turns any thrown value into a message a person can act on. */
export function describeAuthError(error: unknown): string {
  if (error instanceof AuthError) return MESSAGES[error.code];
  return MESSAGES.unknown;
}
