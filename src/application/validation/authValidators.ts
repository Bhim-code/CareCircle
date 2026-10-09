import { isRole } from '../../domain/entities/Role';

/** A validator returns an error message, or undefined when the value is fine. */
export type FieldError = string | undefined;

export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): FieldError {
  const email = value.trim();
  if (!email) return 'Enter your email address.';
  if (!EMAIL_PATTERN.test(email)) return 'Enter an email address like name@example.com.';
  return undefined;
}

export function validateName(value: string): FieldError {
  const name = value.trim();
  if (!name) return 'Enter your name.';
  if (name.length > 80) return 'Use 80 characters or fewer.';
  return undefined;
}

export function validatePassword(value: string): FieldError {
  if (!value) return 'Enter a password.';
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return undefined;
}

export function validateConfirmation(password: string, confirmation: string): FieldError {
  if (!confirmation) return 'Enter your password again.';
  if (password !== confirmation) return 'The two passwords do not match.';
  return undefined;
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

function collect<K extends string>(entries: [K, FieldError][]): FieldErrors<K> {
  const errors: FieldErrors<K> = {};
  for (const [key, error] of entries) {
    if (error) errors[key] = error;
  }
  return errors;
}

export interface SignInValues {
  email: string;
  password: string;
}

export function validateSignIn(values: SignInValues): FieldErrors<keyof SignInValues> {
  return collect<keyof SignInValues>([
    ['email', validateEmail(values.email)],
    // On sign-in we only check that something was typed, not the password rules.
    ['password', values.password ? undefined : 'Enter your password.'],
  ]);
}

export interface SignUpValues {
  role: string;
  name: string;
  email: string;
  password: string;
  confirmation: string;
}

export function validateSignUp(values: SignUpValues): FieldErrors<keyof SignUpValues> {
  return collect<keyof SignUpValues>([
    ['role', isRole(values.role) ? undefined : 'Choose how you will use CareCircle.'],
    ['name', validateName(values.name)],
    ['email', validateEmail(values.email)],
    ['password', validatePassword(values.password)],
    ['confirmation', validateConfirmation(values.password, values.confirmation)],
  ]);
}
