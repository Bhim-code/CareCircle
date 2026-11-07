import type { IProfileService } from '../../domain/services/IProfileService';

/** Pretends to save a name, for running the app with no server. */
export class DemoProfileService implements IProfileService {
  constructor(private readonly latencyMs = 300) {}

  async updateName(name: string): Promise<string> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    return name.trim();
  }
}
