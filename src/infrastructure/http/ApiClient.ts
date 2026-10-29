import { ApiError } from './ApiError';
import type { TokenStore } from './TokenStore';

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  /** Added to the address as ?a=1&b=2. Empty values (null, undefined) are left out. */
  readonly query?: Readonly<Record<string, QueryValue>>;
  /** Sent as JSON. A FormData (for photo and document uploads) is sent as it is. */
  readonly body?: unknown;
  /** false for calls made before sign-in (sign-in, sign-up, password reset). Default true. */
  readonly auth?: boolean;
  /** Overrides the client's time limit, for slow calls such as uploads. */
  readonly timeoutMs?: number;
  /** Lets the caller cancel, for example when a screen closes. A cancel is rethrown, not an ApiError. */
  readonly signal?: AbortSignal;
}

export interface ApiClientOptions {
  /** Where the backend lives, for example https://carecircle-api.example.com */
  readonly baseUrl: string;
  readonly tokens: TokenStore;
  /** Defaults to the global fetch. Tests pass a fake. */
  readonly fetch?: typeof fetch;
  /** Default time limit for one call. */
  readonly timeoutMs?: number;
  /** Called once when the sign-in can no longer be renewed, so the app can show the sign-in screen. */
  readonly onSessionExpired?: () => void;
}

const DEFAULT_TIMEOUT_MS = 15_000;

const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  400: 'The request was not understood.',
  401: 'Please sign in.',
  403: 'You are not allowed to do this.',
  404: 'Not found.',
  409: 'This conflicts with something that already exists.',
  413: 'That file is too large.',
  422: 'Please check what you entered.',
  429: 'Too many requests. Please wait and try again.',
};

const STATUS_CODES: Readonly<Record<number, string>> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'too_large',
  422: 'invalid',
  429: 'too_many_requests',
};

function fallbackMessage(status: number): string {
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
  if (status >= 500) return 'The server had a problem. Please try again in a moment.';
  return 'Something went wrong.';
}

function isFormData(body: unknown): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFields(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const fields: Record<string, string> = {};
  for (const [name, text] of Object.entries(value)) {
    if (typeof text === 'string') fields[name] = text;
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

/**
 * Talks to the CareCircle backend (backend/, see backend/docs/CONTRACT-NOTES.md).
 *
 * - Adds the access token to every call that needs one.
 * - When the server says 401, renews the tokens once and repeats the call.
 *   Refresh tokens are single-use, so only ONE renewal ever runs at a time:
 *   calls that fail meanwhile wait for it and reuse its result. Sending two at
 *   once would look like token theft to the server and end the sign-in everywhere.
 * - Turns every failure into an ApiError with a code and a message fit to show.
 *
 * It knows nothing about screens, medicines or reminders. The services built on
 * top of it (sign-in, reminders, records...) decide what each call means.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly tokens: TokenStore;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly onSessionExpired: (() => void) | undefined;
  private refreshing: Promise<string> | null = null;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    this.tokens = options.tokens;
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onSessionExpired = options.onSessionExpired;
  }

  get<T>(path: string, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  patch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  delete<T = void>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('DELETE', path, { ...options, body });
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    if (options.auth === false) {
      return this.send<T>(method, path, options, null);
    }

    const tokens = await this.tokens.get();
    if (!tokens) throw new ApiError(401, 'unauthenticated', STATUS_MESSAGES[401]);

    try {
      return await this.send<T>(method, path, options, tokens.accessToken);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      const freshAccessToken = await this.renewAfterRejection(tokens.accessToken);
      // One retry only. If the server still says 401 the error goes to the caller.
      return this.send<T>(method, path, options, freshAccessToken);
    }
  }

  /**
   * Gets a working access token after the server rejected `rejected`.
   * If another call already renewed the tokens, reuses them instead of renewing again.
   */
  private async renewAfterRejection(rejected: string): Promise<string> {
    const current = await this.tokens.get();
    if (!current) throw this.sessionEnded();
    if (current.accessToken !== rejected) return current.accessToken;

    // No await between this check and the assignment, so two calls can never both start a renewal.
    if (!this.refreshing) {
      this.refreshing = this.renew(current.refreshToken).finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async renew(refreshToken: string): Promise<string> {
    let result: unknown;
    try {
      result = await this.send<unknown>('POST', '/auth/refresh', { body: { refreshToken } }, null);
    } catch (error) {
      // Only a clear "no" from the server ends the sign-in. No signal, a timeout or a
      // server fault keep the tokens, so the person is not signed out for a bad moment.
      if (error instanceof ApiError && error.status === 401) {
        await this.tokens.clear();
        this.onSessionExpired?.();
        throw this.sessionEnded();
      }
      throw error;
    }

    if (
      !isRecord(result) ||
      typeof result.accessToken !== 'string' ||
      typeof result.refreshToken !== 'string'
    ) {
      throw new ApiError(200, 'bad_response', 'The server sent something the app could not read.');
    }
    // The new refresh token MUST be saved: the old one no longer works.
    await this.tokens.set({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    return result.accessToken;
  }

  private sessionEnded(): ApiError {
    return new ApiError(401, 'session_expired', 'Your session has ended. Please sign in again.');
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const base = `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    if (!query) return base;
    const parts: string[] = [];
    for (const [name, value] of Object.entries(query)) {
      if (value === null || value === undefined) continue;
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
    return parts.length > 0 ? `${base}?${parts.join('&')}` : base;
  }

  private async send<T>(
    method: string,
    path: string,
    options: RequestOptions,
    accessToken: string | null,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      if (isFormData(options.body)) {
        // fetch must add the multipart boundary itself, so no Content-Type here.
        body = options.body;
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(options.body);
      }
    }
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? this.timeoutMs);
    const callerSignal = options.signal;
    const onCallerAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }

    try {
      let response: Response;
      try {
        response = await this.fetchFn(this.buildUrl(path, options.query), {
          method,
          headers,
          body,
          signal: controller.signal,
        });
      } catch (error) {
        if (timedOut) {
          throw new ApiError(0, 'timeout', 'The server took too long to answer. Please try again.');
        }
        if (callerSignal?.aborted) throw error;
        throw new ApiError(
          0,
          'network',
          'Could not reach the server. Check your connection and try again.',
        );
      }

      let text: string;
      try {
        text = response.status === 204 ? '' : await response.text();
      } catch {
        if (timedOut) {
          throw new ApiError(0, 'timeout', 'The server took too long to answer. Please try again.');
        }
        throw new ApiError(0, 'network', 'The connection dropped. Please try again.');
      }

      let payload: unknown;
      let unreadable = false;
      if (text !== '') {
        try {
          payload = JSON.parse(text);
        } catch {
          unreadable = true;
        }
      }

      if (!response.ok) {
        throw this.errorFrom(response, unreadable ? undefined : payload);
      }
      if (unreadable) {
        throw new ApiError(
          response.status,
          'bad_response',
          'The server sent something the app could not read.',
        );
      }
      return payload as T;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }

  private errorFrom(response: Response, payload: unknown): ApiError {
    const status = response.status;
    // The backend's shape: { "error": { "code", "message", "fields"? } }.
    // Its messages never contain request data, so they are safe to show.
    const sent = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
    const code =
      typeof sent?.code === 'string' && sent.code !== ''
        ? sent.code
        : (STATUS_CODES[status] ?? 'error');
    const message =
      typeof sent?.message === 'string' && sent.message !== ''
        ? sent.message
        : fallbackMessage(status);

    const retryHeader = Number(response.headers.get('Retry-After'));
    const retryAfterSeconds =
      status === 429 && Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined;

    return new ApiError(status, code, message, {
      fields: readFields(sent?.fields),
      retryAfterSeconds,
    });
  }
}
