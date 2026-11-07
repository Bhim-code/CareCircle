import { validateName } from './validation/authValidators';

/** An error message for the name box, or undefined when the name is fine. */
export function validateNewName(value: string, currentName: string): string | undefined {
  const problem = validateName(value);
  if (problem) return problem;
  if (value.trim() === currentName.trim()) return 'That is already your name.';
  return undefined;
}

/** A sentence for a name that could not be saved. It reads only `status`, `code`, `message` and `fields`. */
export function describeProfileError(error: unknown): string {
  const read = (key: string): unknown =>
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>)[key] : undefined;
  const code = typeof read('code') === 'string' ? (read('code') as string) : '';
  const status = typeof read('status') === 'number' ? (read('status') as number) : 0;
  const fields = read('fields');
  const nameProblem =
    typeof fields === 'object' && fields !== null && typeof (fields as Record<string, unknown>).name === 'string'
      ? (fields as Record<string, string>).name
      : '';

  if (code === 'network' || code === 'timeout') return 'Cannot reach the server. Check your connection and try again.';
  if (code === 'session_expired' || code === 'unauthenticated') return 'Your sign-in has ended. Please sign in again.';
  if (status === 422 && nameProblem) return nameProblem;
  return 'We could not save your name. Please try again.';
}
