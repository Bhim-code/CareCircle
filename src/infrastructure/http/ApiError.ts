/**
 * The only error the API client throws. Screens and services never see a raw
 * fetch failure or a response body, only a code and a plain-language message.
 *
 * Codes the client makes up itself:
 *   network          the phone could not reach the server (status 0)
 *   timeout          the server took too long (status 0)
 *   session_expired  the sign-in can no longer be renewed; the person must sign in again
 *   bad_response     the server answered with something the app cannot read
 *
 * Any other code is the one the backend sent, for example `email_taken`,
 * `not_due` or `unauthenticated` (see backend/docs/CONTRACT-NOTES.md).
 */
export class ApiError extends Error {
  /** HTTP status, or 0 when there was no answer at all. */
  readonly status: number;
  readonly code: string;
  /** Per-field problems from a 422, such as { email: 'This email is already registered.' }. */
  readonly fields: Readonly<Record<string, string>> | undefined;
  /** For a 429: how long the server asked us to wait. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: {
      fields?: Readonly<Record<string, string>>;
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = extra.fields;
    this.retryAfterSeconds = extra.retryAfterSeconds;
  }

  /** True when the phone has no connection to the server (as opposed to the server saying no). */
  get isConnectionProblem(): boolean {
    return this.status === 0;
  }
}
