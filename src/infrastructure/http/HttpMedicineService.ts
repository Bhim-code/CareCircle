import type { Medicine, MedicineInput } from '../../domain/entities/Medicine';
import type { IMedicineService } from '../../domain/services/IMedicineService';
import { ApiClient } from './ApiClient';
import { ApiError } from './ApiError';

function badAnswer(): ApiError {
  return new ApiError(200, 'bad_response', 'The server sent something the app could not read.');
}

const TIME = /^\d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Reads one medicine as the backend sends it (MedicineOut in backend/app/schemas/medicines.py). */
function toMedicine(dto: unknown): Medicine {
  if (typeof dto !== 'object' || dto === null) throw badAnswer();
  const row = dto as Record<string, unknown>;
  const times = row.times;
  if (
    typeof row.id !== 'string' ||
    typeof row.name !== 'string' ||
    !Array.isArray(times) ||
    !times.every((time) => typeof time === 'string' && TIME.test(time)) ||
    typeof row.startDate !== 'string' ||
    !DAY.test(row.startDate) ||
    !(row.endDate === null || row.endDate === undefined || (typeof row.endDate === 'string' && DAY.test(row.endDate))) ||
    !(row.stoppedAt === null || row.stoppedAt === undefined || typeof row.stoppedAt === 'string')
  ) {
    // One unreadable medicine must not be quietly left out of a medication list.
    throw badAnswer();
  }
  return {
    id: row.id,
    name: row.name,
    times: [...(times as string[])].sort(),
    startDate: row.startDate,
    endDate: typeof row.endDate === 'string' ? row.endDate : null,
    stoppedAt: typeof row.stoppedAt === 'string' ? row.stoppedAt : null,
  };
}

/**
 * The patient's medicines from the CareCircle backend.
 *
 * The server only gives medicines to the signed-in patient, so `userId` is not sent:
 * who is asking comes from the sign-in token, and one person can never read or stop
 * another's medicines.
 */
export class HttpMedicineService implements IMedicineService {
  constructor(private readonly api: ApiClient) {}

  async list(_userId: string): Promise<readonly Medicine[]> {
    const answer = await this.api.get<unknown>('/medicines');
    if (!Array.isArray(answer)) throw badAnswer();
    return answer.map(toMedicine);
  }

  async add(_userId: string, input: MedicineInput): Promise<Medicine> {
    const answer = await this.api.post<unknown>('/medicines', {
      name: input.name,
      times: input.times,
      startDate: input.startDate,
      ...(input.endDate ? { endDate: input.endDate } : {}),
    });
    return toMedicine(answer);
  }

  async stop(_userId: string, medicineId: string): Promise<void> {
    // Stopping twice is harmless on the server.
    await this.api.delete(`/medicines/${encodeURIComponent(medicineId)}`);
  }
}
