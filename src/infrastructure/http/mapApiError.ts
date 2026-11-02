import { AuthError } from '../../domain/errors/AuthError';
import { ApiError } from './ApiError';

/**
 * Turns what the backend said into the app's own AuthError, so the sign-in
 * screens keep showing the same messages whichever backend is behind them.
 *
 * Only use this for the calls made while signed out (sign-in, sign-up, password
 * reset): there a 401 means "wrong email or password", not "session ended".
 */
export function mapApiAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  if (!(error instanceof ApiError)) return new AuthError('unknown');

  if (error.status === 0) return new AuthError('network'); // no answer, or too slow

  switch (error.code) {
    case 'email_taken':
      return new AuthError('email_taken');
    case 'too_many_requests':
      return new AuthError('rate_limited');
    case 'unauthenticated':
      return new AuthError('invalid_credentials');
    default:
      break;
  }

  if (error.status === 422 && error.fields) {
    if (error.fields.email) return new AuthError('invalid_email');
    if (error.fields.password || error.fields.newPassword) return new AuthError('weak_password');
  }
  return new AuthError('unknown');
}
