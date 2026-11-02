/**
 * A sentence a person can act on for any failed save or load. It looks only at the
 * error's `code`, so it works for whatever backend sits behind the service.
 */
export function describeServiceError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : '';
  switch (code) {
    case 'network':
    case 'timeout':
      return 'Cannot reach the server. Check your connection and try again.';
    case 'too_many_requests':
      return 'Too many requests. Wait a minute, then try again.';
    case 'session_expired':
    case 'unauthenticated':
      return 'Your sign-in has ended. Please sign in again.';
    case 'forbidden':
      return 'Your account is not allowed to do this.';
    default:
      return 'We could not save that. Please try again.';
  }
}
