import type { CareLink } from '../../domain/entities/CareLink';
import type { ICareLinkService } from '../../domain/services/ICareLinkService';

/** Used when no backend address is set (and not in demo mode): there are no links to show. */
export class EmptyCareLinkService implements ICareLinkService {
  async list(_userId: string): Promise<readonly CareLink[]> {
    return [];
  }

  async invite(_userId: string, _email: string): Promise<CareLink> {
    throw new Error('Care links are not available yet.');
  }

  async accept(_userId: string, _linkId: string): Promise<CareLink> {
    throw new Error('Care links are not available yet.');
  }

  async remove(_userId: string, _linkId: string): Promise<void> {
    throw new Error('Care links are not available yet.');
  }
}
