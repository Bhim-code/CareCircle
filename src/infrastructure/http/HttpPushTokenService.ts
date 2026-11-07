import type { IPushTokenService } from '../../domain/services/IPushTokenService';
import { ApiClient } from './ApiClient';

/** Push tokens on the CareCircle backend (PUT and DELETE /me/push-token). */
export class HttpPushTokenService implements IPushTokenService {
  constructor(private readonly api: ApiClient) {}

  async register(token: string): Promise<void> {
    await this.api.put<void>('/me/push-token', { token });
  }

  async unregister(token: string): Promise<void> {
    await this.api.delete<void>('/me/push-token', { token });
  }
}
