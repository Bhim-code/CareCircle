import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DemoCareTaskService } from '../src/infrastructure/demo/DemoCareTaskService';
import { DEMO_CAREGIVER_ID, DEMO_PATIENT_ID } from '../src/infrastructure/demo/demoIds';
import { EmptyCareTaskService } from '../src/infrastructure/supabase/EmptyCareTaskService';

// A fixed clock: 6 Nov 2026, 1:00 PM local time.
const clock = (hour = 13, minute = 0) => () => new Date(2026, 10, 6, hour, minute, 0);
const make = (now = clock()) => new DemoCareTaskService(0, now);
const TODAY = '2026-11-06';
const reasonOf = async (promise: Promise<unknown>) => {
  try { await promise; return 'ok'; } catch (e) { return `${(e as { status?: number }).status} ${(e as { code?: string }).code}`; }
};

describe('DemoCareTaskService', () => {
  it('shows the same five tasks to the patient and the caregiver, and nothing to anyone else', async () => {
    const service = make();
    const [forCaregiver] = await service.listDay(DEMO_CAREGIVER_ID);
    const [forPatient] = await service.listDay(DEMO_PATIENT_ID);
    assert.equal(forCaregiver.tasks.length, 5);
    assert.equal(forCaregiver.client.id, DEMO_PATIENT_ID);
    assert.equal(forPatient.tasks.length, 5);
    assert.deepEqual(await service.listDay('someone-else'), []);
  });

  it('works out the status from the clock: done-in-time tasks are due, later ones upcoming, old ones missed', async () => {
    const [day] = await make(clock(13, 0)).listDay(DEMO_CAREGIVER_ID);
    const status = (id: string) => day.tasks.find((t) => t.taskId === id)?.status;
    assert.equal(status('demo-task-1'), 'missed'); // 9:00 + 60 min grace is over
    assert.equal(status('demo-task-2'), 'due'); // 12:30, still inside its hour and a half
    assert.equal(status('demo-task-3'), 'upcoming'); // 15:00
    assert.equal(status('demo-task-5'), 'due'); // any time that day
    assert.equal(day.counts.missed, 1);
    assert.equal(day.counts.due, 2);
    assert.equal(day.counts.upcoming, 2);
  });

  it('lets only the caregiver mark, and a patient can only look', async () => {
    const service = make();
    assert.equal(await reasonOf(service.mark(DEMO_PATIENT_ID, 'demo-task-2', TODAY, { status: 'done' })), '403 forbidden');
    const updated = await service.mark(DEMO_CAREGIVER_ID, 'demo-task-2', TODAY, { status: 'done' });
    assert.equal(updated.tasks.find((t) => t.taskId === 'demo-task-2')?.status, 'done');
    assert.equal(updated.tasks.find((t) => t.taskId === 'demo-task-2')?.mark?.doneBy.name, 'Sam Caregiver');
    const [patientView] = await service.listDay(DEMO_PATIENT_ID);
    assert.equal(patientView.tasks.find((t) => t.taskId === 'demo-task-2')?.status, 'done');
  });

  it('calls a task done after its deadline "late"', async () => {
    const [day] = await make(clock(13, 0)).listDay(DEMO_CAREGIVER_ID);
    assert.equal(day.tasks.find((t) => t.taskId === 'demo-task-1')?.status, 'missed');
    const late = await make(clock(13, 0)).mark(DEMO_CAREGIVER_ID, 'demo-task-1', TODAY, { status: 'done' });
    assert.equal(late.tasks.find((t) => t.taskId === 'demo-task-1')?.status, 'late');
  });

  it('refuses a second mark, a skip without a reason, an unknown task and a future day', async () => {
    const service = make();
    await service.mark(DEMO_CAREGIVER_ID, 'demo-task-2', TODAY, { status: 'done' });
    assert.equal(await reasonOf(service.mark(DEMO_CAREGIVER_ID, 'demo-task-2', TODAY, { status: 'done' })), '409 already_marked');
    assert.equal(await reasonOf(service.mark(DEMO_CAREGIVER_ID, 'demo-task-3', TODAY, { status: 'skipped', reason: '  ' })), '422 invalid');
    assert.equal(await reasonOf(service.mark(DEMO_CAREGIVER_ID, 'nope', TODAY, { status: 'done' })), '404 not_found');
    assert.equal(await reasonOf(service.mark(DEMO_CAREGIVER_ID, 'demo-task-3', '2026-11-07', { status: 'done' })), '422 invalid');
  });

  it('keeps the reason of a skip and shows it as skipped', async () => {
    const updated = await make().mark(DEMO_CAREGIVER_ID, 'demo-task-3', TODAY, { status: 'skipped', reason: ' Ana was resting ' });
    const task = updated.tasks.find((t) => t.taskId === 'demo-task-3');
    assert.equal(task?.status, 'skipped');
    assert.equal(task?.mark?.reason, 'Ana was resting');
    assert.equal(updated.counts.skipped, 1);
  });

  it('takes a mark back, but not someone elses, and not after 24 hours', async () => {
    let now = clock();
    const service = new DemoCareTaskService(0, () => now());
    await service.mark(DEMO_CAREGIVER_ID, 'demo-task-2', TODAY, { status: 'done' });
    assert.equal(await reasonOf(service.undo(DEMO_PATIENT_ID, 'demo-task-2', TODAY)), '403 forbidden');
    await service.undo(DEMO_CAREGIVER_ID, 'demo-task-2', TODAY);
    const [day] = await service.listDay(DEMO_CAREGIVER_ID);
    assert.equal(day.tasks.find((t) => t.taskId === 'demo-task-2')?.mark, null);
    assert.equal(await reasonOf(service.undo(DEMO_CAREGIVER_ID, 'demo-task-2', TODAY)), '404 not_found');

    await service.mark(DEMO_CAREGIVER_ID, 'demo-task-2', TODAY, { status: 'done' });
    now = () => new Date(2026, 10, 7, 14, 0, 0); // 25 hours later
    assert.equal(await reasonOf(service.undo(DEMO_CAREGIVER_ID, 'demo-task-2', TODAY)), '422 too_late');
  });

  it('logs extra work for today, only for the caregiver', async () => {
    const service = make();
    assert.equal(await reasonOf(service.addExtra(DEMO_PATIENT_ID, { title: 'Walk' })), '403 forbidden');
    const extra = await service.addExtra(DEMO_CAREGIVER_ID, { title: ' Walk to the park ', note: ' sunny ' });
    assert.equal(extra.title, 'Walk to the park');
    assert.equal(extra.note, 'sunny');
    const [day] = await service.listDay(DEMO_CAREGIVER_ID);
    assert.equal(day.extras.length, 1);
    assert.equal(day.extras[0].doneBy.name, 'Sam Caregiver');
  });
});

describe('EmptyCareTaskService', () => {
  it('lists nothing and refuses to save, until a backend exists', async () => {
    const service = new EmptyCareTaskService();
    assert.deepEqual(await service.listDay('u'), []);
    await assert.rejects(service.mark('u', 't', TODAY, { status: 'done' }));
    await assert.rejects(service.undo('u', 't', TODAY));
    await assert.rejects(service.addExtra('u', { title: 'x' }));
  });
});
