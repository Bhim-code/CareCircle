import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiClient } from '../src/infrastructure/http/ApiClient';
import { HttpHealthRecordService } from '../src/infrastructure/http/HttpHealthRecordService';
import { TokenStore } from '../src/infrastructure/http/TokenStore';
import { MemorySessionStorage } from '../src/infrastructure/storage/MemorySessionStorage';

const BASE = 'https://api.test';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Call { url: string; method: string; form: FormData | undefined }

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
        form: init.body instanceof FormData ? init.body : undefined,
      };
      calls.push(call);
      return handler(call);
    }) as unknown as typeof fetch,
  });
  const service = new HttpHealthRecordService(api, (form, file) => form.append('file', new Blob(['x']), file.name));
  return { service, calls };
}

const DOC = {
  id: 'd-1', title: 'Blood test', category: 'lab_report', recordedOn: '2026-10-29', patientId: 'p-1',
  fileType: 'pdf', fileName: 'b.pdf', sizeBytes: 2048, fileUri: '/files/documents/d-1?sig=1',
  uploadedBy: { id: 'p-1', name: 'Ana' }, uploadedAt: '2026-11-06T10:00:00Z',
};
const FILE = { uri: 'file:///b.pdf', name: 'b.pdf', mimeType: 'application/pdf', sizeBytes: 2048 };

describe('HttpHealthRecordService', () => {
  it('lists documents', async () => {
    const { service, calls } = await setup(() => json(200, [DOC]));
    const records = await service.list('p-1');
    assert.equal(calls[0].url, '/health-records');
    assert.equal(records[0].title, 'Blood test');
    assert.equal(records[0].uploadedBy?.name, 'Ana');
    assert.equal(records[0].fileType, 'pdf');
  });

  it('rejects a document it cannot read', async () => {
    const { service } = await setup(() => json(200, [{ ...DOC, category: 'weird' }]));
    await assert.rejects(service.list('p-1'), (e: { code?: string }) => e.code === 'bad_response');
    const again = await setup(() => json(200, { not: 'a list' }));
    await assert.rejects(again.service.list('p-1'));
  });

  it('sends the upload as a form', async () => {
    const { service, calls } = await setup(() => json(201, DOC));
    const saved = await service.upload('p-1', { title: 'Blood test', category: 'lab_report', recordedOn: '2026-10-29', patientId: 'p-9', file: FILE });
    const call = calls[0];
    assert.equal(call.method, 'POST');
    assert.equal(call.url, '/health-records');
    assert.equal(call.form?.get('title'), 'Blood test');
    assert.equal(call.form?.get('category'), 'lab_report');
    assert.equal(call.form?.get('recordedOn'), '2026-10-29');
    assert.equal(call.form?.get('patientId'), 'p-9');
    assert.ok(call.form?.get('file'));
    assert.equal(saved.id, 'd-1');
  });

  it('leaves out an empty date and no client', async () => {
    const { service, calls } = await setup(() => json(201, DOC));
    await service.upload('p-1', { title: 't', category: 'other', recordedOn: null, file: FILE });
    assert.equal(calls[0].form?.has('recordedOn'), false);
    assert.equal(calls[0].form?.has('patientId'), false);
  });

  it('passes on a refused file with its message', async () => {
    const { service } = await setup(() =>
      json(415, { error: { code: 'unsupported_media_type', message: 'No.', fields: { file: 'Only PDF, JPEG, PNG or HEIC.' } } }),
    );
    await assert.rejects(
      service.upload('p-1', { title: 't', category: 'other', recordedOn: null, file: FILE }),
      (e: { status?: number }) => e.status === 415,
    );
    const big = await setup(() => json(413, { error: { code: 'payload_too_large', message: 'Too big.' } }));
    await assert.rejects(
      big.service.upload('p-1', { title: 't', category: 'other', recordedOn: null, file: FILE }),
      (e: { status?: number }) => e.status === 413,
    );
  });

  it('deletes by id', async () => {
    const { service, calls } = await setup(() => new Response(null, { status: 204 }));
    await service.remove('p-1', 'd-1');
    assert.equal(calls[0].method, 'DELETE');
    assert.equal(calls[0].url, '/health-records/d-1');
  });

  it('gets a fresh link by listing again', async () => {
    const { service } = await setup(() => json(200, [DOC]));
    assert.equal(await service.freshLink('p-1', 'd-1'), 'https://api.test/files/documents/d-1?sig=1');
    assert.equal(await service.freshLink('p-1', 'nope'), null);
  });

  it('lists clients from active care links, once each', async () => {
    const link = (id: string, name: string, status: string) => ({ id: `l-${id}-${status}`, status, patient: { id, name, email: 'x' } });
    const { service, calls } = await setup(() =>
      json(200, [link('p-2', 'Zed', 'active'), link('p-1', 'Ana', 'active'), link('p-1', 'Ana', 'active'), link('p-3', 'Old', 'ended'), link('p-4', 'Wait', 'pending')]),
    );
    const clients = await service.clients('c-1');
    assert.equal(calls[0].url, '/care-links');
    assert.deepEqual(clients, [{ id: 'p-1', name: 'Ana' }, { id: 'p-2', name: 'Zed' }]);
  });
});
