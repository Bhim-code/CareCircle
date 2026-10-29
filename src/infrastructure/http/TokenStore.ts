import type { ISessionStorage } from '../../domain/services/ISessionStorage';

/** The pair of tokens the backend gives at sign-in and after every refresh. */
export interface ApiTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export const TOKEN_STORAGE_KEY = 'carecircle.api.tokens';

function isTokens(value: unknown): value is ApiTokens {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accessToken === 'string' &&
    v.accessToken !== '' &&
    typeof v.refreshToken === 'string' &&
    v.refreshToken !== ''
  );
}

/**
 * Remembers the sign-in between app launches, with a copy in memory so the
 * client does not read the disk on every request. Damaged saved data counts
 * as "not signed in" instead of crashing the app.
 */
export class TokenStore {
  private cache: ApiTokens | null | undefined;

  constructor(
    private readonly storage: ISessionStorage,
    private readonly key: string = TOKEN_STORAGE_KEY,
  ) {}

  async get(): Promise<ApiTokens | null> {
    if (this.cache !== undefined) return this.cache;
    let loaded: ApiTokens | null = null;
    try {
      const raw = await this.storage.getItem(this.key);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isTokens(parsed)) loaded = { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
      }
    } catch {
      loaded = null;
    }
    // A set() or clear() that happened while we were reading wins over the disk.
    if (this.cache === undefined) this.cache = loaded;
    return this.cache;
  }

  async set(tokens: ApiTokens): Promise<void> {
    this.cache = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    await this.storage.setItem(this.key, JSON.stringify(this.cache));
  }

  async clear(): Promise<void> {
    this.cache = null;
    await this.storage.removeItem(this.key);
  }
}
