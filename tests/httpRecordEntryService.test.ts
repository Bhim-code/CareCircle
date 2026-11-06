import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addableKinds, canEditEntry, canWrite, describeEntryError } from '../src/application/recordEntries';
import type { RecordEntryInput } from '../src/domain/entities/RecordEntry';
import { ApiClient } from '../src/infrastructure/http/ApiClient';
import { ApiError } from '../src/infrastructure/http/ApiError';
import { HttpRecordEntryService, isServerPhoto } from '../src/infrastructure/http/HttpRecordEntryService';
import { TokenStore } from '../src/infrastructure/http/TokenStore';
import { MemorySessionStorage } from '../src/infrastructure/storage/MemorySessionStorage';

const BASE = 'https://api.test';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Call { url: string; method: string; body: any; form: FormData | undefined }

async function setup(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const tokens = new TokenStore(new MemorySessionStorage());
  await tokens.set({ accessToken: 'a', refreshToken: 'r' });
  const api = new ApiClient({
    baseUrl: BASE,
    tokens,
    fetch: (async (input: string, init: RequestInit = {}) => {
      const call: Call = {
        url: String(input).replace(BASE, ''),
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
        form: init.body instanceof FormData ? init.body : undefined,
      };
      calls.push(call);
      return handler(call);
    }) as unknown as typeof fetch,
  });
  const service = new HttpRecordEntryService(api, (form, uri) => form.append('file', new Blob(['x']), uri.split('/').pop()));
  return { service, calls };
}

const ANA = { id: 'p-1', name: 'Ana Patient', role: 'patient' };
const SAM = { id: 'c-1', name: 'Sam Caregiver', role: 'caregiver' };
const ENTRY = {
  id: 'e-1', patientId: 'p-1', kind: 'medication', clientName: null, title: 'Metformin', notes: null,
  occurredAt: '2026-11-06T14:00:00.000Z', witnessName: null, location: null, severity: null, actionTaken: null,
  mood: null, medicineName: 'Metformin', photoUri: '/files/photos/ph-1?expires=1&sig=x',
  recordedAt: '2026-11-06T14:05:00.000Z', recordedBy: SAM, editedAt: null, editedBy: null,
};
const INPUT: RecordEntryInput = {
  kind: 'medication', clientName: 'Ana Patient', title: 'Metformin', notes: '', occurredAt: '2026-11-06T14:00:00.000Z',
  witnessName: null, location: null, severity: null, actionTaken: null, mood: null, medicineName: 'Metformin', photoUri: null,
};
const author = { id: 'c-1', name: 'Sam Caregiver', role: 'caregiver' as const };

describe('HttpRecordEntryService', () => {
  it('lists entries and fills in what the server leaves empty', async () => {
    const { service, calls } = await setup(() => json(200, [ENTRY]));
    const [entry] = await service.list('c-1');
    assert.equal(calls[0].url, '/entries');
    assert.equal(entry.clientName, '');
    assert.equal(entry.notes, '');
    assert.equal(entry.recordedBy.name, 'Sam Caregiver');
    assert.equal(entry.photoUri, 'https://api.test/files/photos/ph-1?expires=1&sig=x');
    assert.equal(entry.editedBy, null);
  });

  it('shows an unknown role as a caregiver, and rejects an unreadable entry', async () => {
    const odd = await setup(() => json(200, [{ ...ENTRY, recordedBy: { ...SAM, role: 'supervisor' } }]));
    assert.equal((await odd.service.list('c-1'))[0].recordedBy.role, 'caregiver');
    const bad = await setup(() => json(200, [{ ...ENTRY, kind: 'weird' }]));
    await assert.rejects(bad.service.list('c-1'), (e: { code?: string }) => e.code === 'bad_response');
    const notList = await setup(() => json(200, { nope: true }));
    await assert.rejects(notList.service.list('c-1'));
  });

  it('adds an entry without a photo', async () => {
    const { service, calls } = await setup(() => json(201, { ...ENTRY, photoUri: null }));
    await service.add(author, { ...INPUT, patientId: 'p-9' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, '/entries');
    assert.equal(calls[0].body.kind, 'medication');
    assert.equal(calls[0].body.photoUri, null);
    assert.equal(calls[0].body.patientId, 'p-9');
    assert.equal(calls[0].body.occurredAt, '2026-11-06T14:00:00.000Z');
  });

  it('leaves patientId out when it is not chosen', async () => {
    const { service, calls } = await setup(() => json(201, ENTRY));
    await service.add(author, INPUT);
    assert.equal('patientId' in calls[0].body, false);
  });

  it('sends a photo from the phone first, then saves the entry with the link it got', async () => {
    const { service, calls } = await setup((call) =>
      call.url === '/entries/photo' ? json(201, { photoUri: '/files/photos/new-1?expires=2&sig=y' }) : json(201, ENTRY),
    );
    await service.add(author, { ...INPUT, photoUri: 'file:///cache/shot.jpg' });
    assert.equal(calls[0].url, '/entries/photo');
    assert.ok(calls[0].form?.get('file'));
    assert.equal(calls[1].url, '/entries');
    assert.equal(calls[1].body.photoUri, '/files/photos/new-1?expires=2&sig=y');
  });

  it('keeps a photo the server already holds, without sending it again', async () => {
    const { service, calls } = await setup(() => json(200, ENTRY));
    await service.update(author, 'e-1', { ...INPUT, photoUri: 'https://api.test/files/photos/ph-1?expires=1&sig=x' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PUT');
    assert.equal(calls[0].url, '/entries/e-1');
    assert.equal(calls[0].body.photoUri, 'https://api.test/files/photos/ph-1?expires=1&sig=x');
  });

  it('removes the photo when the person removed it', async () => {
    const { service, calls } = await setup(() => json(200, { ...ENTRY, photoUri: null }));
    await service.update(author, 'e-1', { ...INPUT, photoUri: null });
    assert.equal(calls[0].body.photoUri, null);
  });

  it('passes on refusals', async () => {
    const forbidden = await setup(() => json(403, { error: { code: 'forbidden', message: 'You do not have permission to write incident records.' } }));
    await assert.rejects(forbidden.service.add(author, INPUT), (e: { status?: number }) => e.status === 403);
  });

  it('lists clients from active care links, once each', async () => {
    const link = (id: string, name: string, status: string) => ({ id: `l-${id}`, status, patient: { id, name } });
    const { service } = await setup(() => json(200, [link('p-2', 'Zed', 'active'), link('p-1', 'Ana', 'active'), link('p-1', 'Ana', 'active'), link('p-3', 'Old', 'ended')]));
    assert.deepEqual(await service.clients('c-1'), [{ id: 'p-1', name: 'Ana' }, { id: 'p-2', name: 'Zed' }]);
  });

  it('tells a server photo from one on the phone', () => {
    assert.ok(isServerPhoto('https://x.test/files/photos/abc?expires=1&sig=2'));
    assert.ok(isServerPhoto('/files/photos/abc'));
    assert.ok(!isServerPhoto('file:///data/user/0/cache/shot.jpg'));
  });
});

describe('permissions for written records', () => {
  const caregiverPermissions = ['tasks.view', 'entries.write.behavioural', 'entries.write.incident'];
  it('lists the kinds from the permissions the server gave', () => {
    assert.deepEqual(addableKinds(caregiverPermissions), ['behavioural', 'incident']);
    assert.deepEqual(addableKinds(undefined), []);
    assert.deepEqual(addableKinds([]), []);
  });
  it('checks one kind', () => {
    assert.ok(canWrite(caregiverPermissions, 'incident'));
    assert.ok(!canWrite(caregiverPermissions, 'medical'));
  });
  it('lets only the author edit, and only while still allowed to write that kind', () => {
    const entry = { ...INPUT, id: 'e', recordedAt: '', recordedBy: SAM as never, editedAt: null, editedBy: null };
    assert.ok(canEditEntry(['entries.write.medication'], 'c-1', entry));
    assert.ok(!canEditEntry(['entries.write.medication'], 'p-1', entry));
    assert.ok(!canEditEntry(['entries.write.incident'], 'c-1', entry));
  });
});

describe('describeEntryError', () => {
  it('speaks plainly about each failure', () => {
    assert.match(describeEntryError(new ApiError(0, 'network', 'x')), /connection/);
    assert.match(describeEntryError(new ApiError(413, 'too_large', 'x')), /5 MB/);
    assert.match(describeEntryError(new ApiError(415, 'unsupported_media_type', 'x')), /JPEG and PNG/);
    assert.equal(describeEntryError(new ApiError(403, 'forbidden', 'Only the person who wrote this record can edit it.')), 'Only the person who wrote this record can edit it.');
    assert.match(describeEntryError(new ApiError(404, 'not_found', 'x')), /no longer available/);
    assert.equal(describeEntryError(new ApiError(422, 'invalid', 'x', { fields: { patientId: 'Choose which linked patient this is about.' } })), 'Choose which linked patient this is about.');
    assert.match(describeEntryError(new Error('boom')), /try again/);
  });
});
