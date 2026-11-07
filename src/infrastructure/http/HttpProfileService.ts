import type { IProfileService } from '../../domain/services/IProfileService';
import { ApiClient } from './ApiClient';
import { ApiError } from './ApiError';

/** Changes the person's own details on the backend (PATCH /me). */
export class HttpProfileService implements IProfileService {
  constructor(private readonly api: ApiClient) {}

  async updateName(name: string): Promise<string> {
    const answer = await this.api.patch<unknown>('/me', { name: name.trim() });
    if (typeof answer !== 'object' || answer === null || typeof (answer as { name?: unknown }).name !== 'string') {
      throw new ApiError(200, 'bad_response', 'The server sent something the app could not read.');
    }
    return (answer as { name: string }).name;
  }
}
