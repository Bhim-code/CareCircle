export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'email_taken'
  | 'invalid_email'
  | 'weak_password'
  | 'rate_limited'
  | 'network'
  | 'profile_unavailable'
  | 'unknown';

/**
 * The only error type auth services throw. Screens never see a
 * provider-specific error, so swapping Supabase for another backend
 * does not change any UI code.
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AuthError';
    this.code = code;
  }
}
