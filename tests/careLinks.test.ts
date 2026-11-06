import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeCareLinkError, groupLinks, otherPerson, validateInviteEmail } from '../src/application/careLinks';
import type { CareLink } from '../src/domain/entities/CareLink';
import { DemoCareLinkService } from '../src/infrastructure/demo/DemoCareLinkService';
import { DEMO_CAREGIVER_ID, DEMO_PATIENT_ID } from '../src/infrastructure/demo/demoIds';
import { ApiClient } from '../src/infrastructure/http/ApiClient';
import { ApiError } from '../src/infrastructure/http/ApiError';
import { HttpCareLinkService } from '../src/infrastructure/http/HttpCareLinkService';
import { TokenStore } from '../src/infrastructure/http/TokenStore';
import { MemorySessionStorage } from '../src/infrastructure/storage/MemorySessionStorage';

const ANA = { id: 'p-1', name: 'Ana Patient', email: 'ana@x.test' };
const SAM = { id: 'c-1', name: 'Sam Caregiver', email: 'sam@x.test' };
const link = (over: Partial<CareLink>): CareLink => ({
  id: 'l-1', status: 'active', invitedEmail: SAM.email, patient: ANA, caregiver: SAM, createdAt: '2026-11-06T10:00:00Z', acceptedAt: '2026-11-06T11:00:00Z', ...over,
});

describe('validateInviteEmail', () => {
  it('asks for a real address that is not your own', () => {
    assert.match(validateInviteEmail('', 'me@x.test')!, /Enter the email/);
    assert.match(validateInviteEmail('nope', 'me@x.test')!, /name@example.com/);
    assert.match(validateInviteEmail(' ME@x.test ', 'me@x.test')!, /your own/);
    assert.equal(validateInviteEmail(' sam@x.test ', 'me@x.test'), undefined);
  });
});

describe('groupLinks and otherPerson', () => {
  it('splits active and pending, ignores ended, and sorts by name', () => {
    const zed = link({ id: 'a', caregiver: { ...SAM, name: 'Zed' } });
    const amy = link({ id: 'b', caregiver: { ...SAM, name: 'Amy' } });
    const waiting = link({ id: 'c', status: 'pending', caregiver: null, invitedEmail: 'new@x.test', acceptedAt: null });
    const over = link({ id: 'd', status: 'ended' });
    const groups = groupLinks([zed, waiting, over, amy]);
    assert.deepEqual(groups.active.map((l) => l.id), ['b', 'a']);
    assert.deepEqual(groups.pending.map((l) => l.id), ['c']);
  });
  it('shows each side the other person', () => {
    assert.deepEqual(otherPerson(link({}), 'p-1'), { name: 'Sam Caregiver', email: 'sam@x.test' });
    assert.deepEqual(otherPerson(link({}), 'c-1'), { name: 'Ana Patient', email: 'ana@x.test' });
    const pending = link({ status: 'pending', caregiver: null, invitedEmail: 'new@x.test' });
    assert.deepEqual(otherPerson(pending, 'p-1'), { name: 'new@x.test', email: 'new@x.test' });
  });
});

describe('describeCareLinkError', () => {
  it('speaks plainly', () => {
    assert.match(describeCareLinkError(new ApiError(0, 'network', 'x')), /connection/);
    assert.match(describeCareLinkError(new ApiError(409, 'already_linked', 'x')), /already invited/);
    assert.match(describeCareLinkError(new ApiError(404, 'not_found', 'x')), /no longer there/);
    assert.match(describeCareLinkError(new ApiError(403, 'forbidden', 'x')), /not allowed/);
    assert.equal(describeCareLinkError(new ApiError(422, 'invalid', 'x', { fields: { email: "Use someone else's email." } })), "Use someone else's email.");
    assert.match(describeCareLinkError(new Error('boom')), /try again/);
  });
});

const BASE = 'https://api.test';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function setup(handler: (c: { url: string; method: string; body: any }) => Response) {
  const calls: { url: string; method: string; body: any }[] = [];
  const tokens = new TokenStore(new MemorySessionStorage());
  await tokens.set({ accessToken: 'a', refreshToken: 'r' });
  const api = new ApiClient({
    baseUrl: BASE, tokens,
    fetch: (async (input: string, init: RequestInit = {}) => {
      const c = { url: String(input).replace(BASE, ''), method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined };
      calls.push(c);
      return handler(c);
    }) as unknown as typeof fetch,
  });
  return { service: new HttpCareLinkService(api), calls };
}
const WIRE = {
  id: 'l-1', status: 'active', invitedEmail: 'sam@x.test',
  patient: { id: 'p-1', name: 'Ana', role: 'patient', email: 'ana@x.test' },
  caregiver: { id: 'c-1', name: 'Sam', role: 'caregiver', email: 'sam@x.test' },
  createdAt: '2026-11-06T10:00:00Z', acceptedAt: '2026-11-06T11:00:00Z', endedAt: null,
};

describe('HttpCareLinkService', () => {
  it('lists links', async () => {
    const { service, calls } = await setup(() => json(200, [WIRE, { ...WIRE, id: 'l-2', status: 'pending', caregiver: null, acceptedAt: null }]));
    const links = await service.list('p-1');
    assert.equal(calls[0].url, '/care-links');
    assert.equal(links[0].caregiver?.name, 'Sam');
    assert.equal(links[1].caregiver, null);
    assert.equal(links[1].status, 'pending');
  });
  it('rejects links it cannot read', async () => {
    const bad = await setup(() => json(200, [{ ...WIRE, status: 'weird' }]));
    await assert.rejects(bad.service.list('p-1'), (e: { code?: string }) => e.code === 'bad_response');
    const notList = await setup(() => json(200, {}));
    await assert.rejects(notList.service.list('p-1'));
  });
  it('invites by email, trimmed', async () => {
    const { service, calls } = await setup(() => json(201, { ...WIRE, status: 'pending', caregiver: null }));
    await service.invite('p-1', ' sam@x.test ');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, '/care-links/invitations');
    assert.deepEqual(calls[0].body, { email: 'sam@x.test' });
  });
  it('accepts and removes by id', async () => {
    const { service, calls } = await setup((c) => (c.method === 'DELETE' ? new Response(null, { status: 204 }) : json(200, WIRE)));
    const accepted = await service.accept('c-1', 'l-1');
    await service.remove('c-1', 'l-1');
    assert.equal(calls[0].url, '/care-links/invitations/l-1/accept');
    assert.equal(accepted.status, 'active');
    assert.equal(calls[1].method, 'DELETE');
    assert.equal(calls[1].url, '/care-links/l-1');
  });
  it('passes on a duplicate invitation', async () => {
    const { service } = await setup(() => json(409, { error: { code: 'already_linked', message: 'This person is already invited or linked.' } }));
    await assert.rejects(service.invite('p-1', 'sam@x.test'), (e: { status?: number; code?: string }) => e.status === 409 && e.code === 'already_linked');
  });
});

describe('DemoCareLinkService', () => {
  const make = () => new DemoCareLinkService(0);
  it('shows the patient Sam, and the caregiver Ana plus an invitation from Ben', async () => {
    const service = make();
    assert.deepEqual((await service.list(DEMO_PATIENT_ID)).map((l) => l.status), ['active']);
    const forSam = await service.list(DEMO_CAREGIVER_ID);
    assert.deepEqual(forSam.map((l) => l.status).sort(), ['active', 'pending']);
  });
  it('invites, refuses duplicates and yourself, and lets the patient cancel', async () => {
    const service = make();
    const sent = await service.invite(DEMO_PATIENT_ID, 'Kim@Example.com');
    assert.equal(sent.status, 'pending');
    assert.equal(sent.invitedEmail, 'kim@example.com');
    await assert.rejects(service.invite(DEMO_PATIENT_ID, 'kim@example.com'), (e: { status?: number }) => e.status === 409);
    await assert.rejects(service.invite(DEMO_PATIENT_ID, 'patient@demo.test'), (e: { status?: number }) => e.status === 422);
    await assert.rejects(service.invite(DEMO_CAREGIVER_ID, 'x@y.test'), (e: { status?: number }) => e.status === 403);
    await service.remove(DEMO_PATIENT_ID, sent.id);
    assert.equal((await service.list(DEMO_PATIENT_ID)).some((l) => l.id === sent.id), false);
  });
  it('lets the caregiver accept or decline, and nobody else', async () => {
    const service = make();
    const pending = (await service.list(DEMO_CAREGIVER_ID)).find((l) => l.status === 'pending')!;
    await assert.rejects(service.accept(DEMO_PATIENT_ID, pending.id));
    const accepted = await service.accept(DEMO_CAREGIVER_ID, pending.id);
    assert.equal(accepted.status, 'active');
    assert.equal(accepted.caregiver?.id, DEMO_CAREGIVER_ID);
    await service.remove(DEMO_CAREGIVER_ID, accepted.id);
    assert.equal((await service.list(DEMO_CAREGIVER_ID)).some((l) => l.id === accepted.id), false);
    await assert.rejects(service.remove(DEMO_CAREGIVER_ID, accepted.id));
  });
});
