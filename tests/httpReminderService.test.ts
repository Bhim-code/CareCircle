import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reminderStatus } from '../src/application/reminders';
import { ApiClient } from '../src/infrastructure/http/ApiClient';
import { ApiError } from '../src/infrastructure/http/ApiError';
import { HttpReminderService } from '../src/infrastructure/http/HttpReminderService';
import { MAX_REMEMBERED_SKIPS, SkippedDoseStore } from '../src/infrastructure/http/SkippedDoseStore';
import { TokenStore } from '../src/infrastructure/http/TokenStore';
import { MemorySessionStorage } from '../src/infrastructure/storage/MemorySessionStorage';

const BASE = 'https://api.test';

interface Seen {
  readonly url: string;
  readonly method: string;
  readonly auth: string | undefined;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const METFORMIN = { id: 'r-1', medicineName: 'Metformin', scheduledAt: '2026-10-29T16:30:00.000Z', acknowledged: false };
const VITAMIN = { id: 'r-2', medicineName: 'Vitamin D', scheduledAt: '2026-10-29T21:00:00.000Z', acknowledged: true };

async function setup(
  handler: (seen: Seen) => Response | Promise<Response>,
  timeZone: () => string | undefined = () => 'America/St_Johns',
) {
  const seen: Seen[] = [];
  const tokens = new TokenStore(new MemorySessionStorage());
  await tokens.set({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  const api = new ApiClient({
    baseUrl: BASE,
    tokens,
    fetch: (async (input: string, init: RequestInit = {}) => {
      const entry: Seen = {
        url: String(input).replace(BASE, ''),
        method: init.method ?? 'GET',
        auth: (init.headers as Record<string, string>).Authorization,
      };
      seen.push(entry);
      return handler(entry);
    }) as unknown as typeof fetch,
  });
  const storage = new MemorySessionStorage();
  const skipped = new SkippedDoseStore(storage);
  return { service: new HttpReminderService(api, skipped, timeZone), seen, skipped, storage };
}

describe('HttpReminderService.listForDay', () => {
  it('asks for the day in the phone time zone and returns the doses', async () => {
    const { service, seen } = await setup(() => json(200, [METFORMIN, VITAMIN]));
    const list = await service.listForDay('u-1', '2026-10-29');
    assert.equal(seen[0].url, '/reminders?day=2026-10-29&timezone=America%2FSt_Johns');
    assert.equal(seen[0].auth, 'Bearer access-1');
    assert.deepEqual(
      list.map((r) => [r.id, r.medicineName, r.acknowledged, r.skipped]),
      [
        ['r-1', 'Metformin', false, false],
        ['r-2', 'Vitamin D', true, false],
      ],
    );
  });

  it('leaves the time zone out when the phone will not say', async () => {
    const { service, seen } = await setup(() => json(200, []), () => undefined);
    await service.listForDay('u-1', '2026-10-29');
    assert.equal(seen[0].url, '/reminders?day=2026-10-29');
  });

  it('returns an empty list for a day with no doses', async () => {
    const { service } = await setup(() => json(200, []));
    assert.deepEqual(await service.listForDay('u-1', '2026-10-30'), []);
  });

  it('keeps the dose times the server gave, unchanged', async () => {
    const { service } = await setup(() => json(200, [METFORMIN]));
    assert.equal((await service.listForDay('u-1', '2026-10-29'))[0].scheduledAt, METFORMIN.scheduledAt);
  });

  it('fails clearly when the server says no, so the screen can offer a retry', async () => {
    const { service } = await setup(() => json(500, { error: { code: 'error', message: 'Something went wrong.' } }));
    await assert.rejects(service.listForDay('u-1', '2026-10-29'), (e: ApiError) => e.status === 500);
  });

  it('fails with a connection error when the phone is offline', async () => {
    const { service } = await setup(() => {
      throw new TypeError('Network request failed');
    });
    await assert.rejects(service.listForDay('u-1', '2026-10-29'), (e: ApiError) => e.code === 'network');
  });

  it('refuses an answer that is not a list', async () => {
    const { service } = await setup(() => json(200, { reminders: [] }));
    await assert.rejects(service.listForDay('u-1', '2026-10-29'), (e: ApiError) => e.code === 'bad_response');
  });

  it('refuses a list with an unreadable dose instead of quietly leaving it out', async () => {
    const broken = [
      { ...METFORMIN, acknowledged: 'yes' },
      { ...METFORMIN, scheduledAt: 'tomorrow-ish' },
      { ...METFORMIN, id: 7 },
      { medicineName: 'No id' },
      null,
    ];
    for (const bad of broken) {
      const { service } = await setup(() => json(200, [VITAMIN, bad]));
      await assert.rejects(service.listForDay('u-1', '2026-10-29'), (e: ApiError) => e.code === 'bad_response');
    }
  });
});

describe('HttpReminderService.acknowledge', () => {
  it('confirms the dose on the server', async () => {
    const { service, seen } = await setup(() => new Response(null, { status: 204 }));
    await service.acknowledge('u-1', 'r-1');
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].url, '/reminders/r-1/acknowledge');
    assert.equal(seen[0].auth, 'Bearer access-1');
  });

  it('escapes the id in the address', async () => {
    const { service, seen } = await setup(() => new Response(null, { status: 204 }));
    await service.acknowledge('u-1', 'a/b c');
    assert.equal(seen[0].url, '/reminders/a%2Fb%20c/acknowledge');
  });

  it('fails when the dose is not due yet, so it is never shown as taken', async () => {
    const { service } = await setup(() =>
      json(422, { error: { code: 'not_due', message: 'This dose is not due yet.', fields: { scheduledAt: 'You can confirm up to 60 minutes early.' } } }),
    );
    await assert.rejects(service.acknowledge('u-1', 'r-1'), (e: ApiError) => e.status === 422 && e.code === 'not_due');
  });

  it('fails for a dose that is not this patient’s', async () => {
    const { service } = await setup(() => json(404, { error: { code: 'not_found', message: 'Not found.' } }));
    await assert.rejects(service.acknowledge('u-1', 'someone-elses'), (e: ApiError) => e.status === 404);
  });

  it('fails when offline, so the screen can say it was not saved', async () => {
    const { service } = await setup(() => {
      throw new TypeError('Network request failed');
    });
    await assert.rejects(service.acknowledge('u-1', 'r-1'), (e: ApiError) => e.code === 'network');
  });
});

describe('HttpReminderService.skip', () => {
  it('remembers the skip on this phone and shows it on the next load', async () => {
    const { service, seen } = await setup(() => json(200, [METFORMIN, VITAMIN]));
    await service.skip('u-1', 'r-1');
    assert.equal(seen.length, 0, 'the backend has no skip yet, so nothing is sent');
    const list = await service.listForDay('u-1', '2026-10-29');
    assert.equal(list.find((r) => r.id === 'r-1')?.skipped, true);
    assert.equal(list.find((r) => r.id === 'r-2')?.skipped, false);
  });

  it('shows the skipped dose as skipped, not missed or due', async () => {
    const { service } = await setup(() => json(200, [METFORMIN]));
    await service.skip('u-1', 'r-1');
    const [dose] = await service.listForDay('u-1', '2026-10-29');
    const hoursLater = new Date(Date.parse(METFORMIN.scheduledAt) + 3 * 3_600_000);
    assert.equal(reminderStatus(dose, hoursLater), 'skipped');
  });

  it('never calls a dose skipped once the server says it was taken', async () => {
    const { service, skipped } = await setup(() => json(200, [{ ...METFORMIN, acknowledged: true }]));
    await skipped.add('u-1', 'r-1');
    const [dose] = await service.listForDay('u-1', '2026-10-29');
    assert.equal(dose.skipped, false);
    assert.equal(reminderStatus(dose, new Date(Date.parse(METFORMIN.scheduledAt) + 1000)), 'acknowledged');
  });

  it('keeps one person’s skips from showing for another person on the same phone', async () => {
    const { service } = await setup(() => json(200, [METFORMIN]));
    await service.skip('u-1', 'r-1');
    assert.equal((await service.listForDay('u-2', '2026-10-29'))[0].skipped, false);
  });
});

describe('SkippedDoseStore', () => {
  it('remembers skips after the app restarts', async () => {
    const storage = new MemorySessionStorage();
    await new SkippedDoseStore(storage).add('u-1', 'r-1');
    assert.deepEqual([...(await new SkippedDoseStore(storage).skippedBy('u-1'))], ['r-1']);
  });

  it('counts two quick skips both, and the same one only once', async () => {
    const store = new SkippedDoseStore(new MemorySessionStorage());
    await Promise.all([store.add('u-1', 'a'), store.add('u-1', 'b'), store.add('u-1', 'a')]);
    assert.deepEqual([...(await store.skippedBy('u-1'))].sort(), ['a', 'b']);
  });

  it('keeps only the most recent skips', async () => {
    const store = new SkippedDoseStore(new MemorySessionStorage());
    for (let i = 0; i < MAX_REMEMBERED_SKIPS + 5; i += 1) await store.add('u-1', `d-${i}`);
    const kept = await store.skippedBy('u-1');
    assert.equal(kept.size, MAX_REMEMBERED_SKIPS);
    assert.equal(kept.has('d-0'), false);
    assert.equal(kept.has(`d-${MAX_REMEMBERED_SKIPS + 4}`), true);
  });

  it('starts empty when the saved data is damaged', async () => {
    for (const junk of ['not json', '{"a":1}', '42', 'null']) {
      const storage = new MemorySessionStorage();
      await storage.setItem('carecircle.skipped.u-1', junk);
      assert.equal((await new SkippedDoseStore(storage).skippedBy('u-1')).size, 0, junk);
    }
  });

  it('reports a failed save instead of pretending the skip worked', async () => {
    const storage = new MemorySessionStorage();
    storage.setItem = async () => {
      throw new Error('disk full');
    };
    const store = new SkippedDoseStore(storage);
    await assert.rejects(store.add('u-1', 'r-1'), /disk full/);
    assert.equal((await store.skippedBy('u-1')).has('r-1'), false);
  });
});
