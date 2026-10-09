import { AuthError } from '../../domain/errors/AuthError';

/** The parts of a Supabase error we look at. */
interface ProviderError {
  code?: string;
  name?: string;
  message?: string;
  status?: number;
}

/** Translates a Supabase error into the app's own AuthError. */
export function mapSupabaseError(error: ProviderError): AuthError {
  switch (error.code) {
    case 'invalid_credentials':
      return new AuthError('invalid_credentials');
    case 'email_not_confirmed':
      return new AuthError('email_not_confirmed');
    case 'user_already_exists':
    case 'email_exists':
      return new AuthError('email_taken');
    case 'weak_password':
      return new AuthError('weak_password');
    case 'validation_failed':
    case 'email_address_invalid':
      return new AuthError('invalid_email');
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return new AuthError('rate_limited');
    default:
      break;
  }

  const isNetwork =
    error.name === 'AuthRetryableFetchError' ||
    error.status === 0 ||
    /network|fetch/i.test(error.message ?? '');
  if (isNetwork) return new AuthError('network');

  return new AuthError('unknown', error.message);
}
