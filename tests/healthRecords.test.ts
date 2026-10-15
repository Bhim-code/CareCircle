import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RECORD_FILTERS,
  categoryLabel,
  countByFilter,
  emptyMessageFor,
  filterRecords,
  formatRecordDate,
  sortRecords,
} from '../src/application/healthRecords';
import { policyFor } from '../src/application/policies/policyFor';
import { HEALTH_RECORD_CATEGORIES, type HealthRecord } from '../src/domain/entities/HealthRecord';
import { DemoAuthService } from '../src/infrastructure/demo/DemoAuthService';
import { DEMO_PATIENT_ID } from '../src/infrastructure/demo/demoIds';
import { DEMO_RECORDS, DemoHealthRecordService } from '../src/infrastructure/demo/DemoHealthRecordService';
import { EmptyHealthRecordService } from '../src/infrastructure/supabase/EmptyHealthRecordService';

const record = (id: string, category: HealthRecord['category'], recordedOn: string | null, title = id): HealthRecord => ({
  id,
  title,
  category,
  recordedOn,
});

describe('categories', () => {
  it('has the five categories the issue asks for, each with a readable name', () => {
    assert.deepEqual([...HEALTH_RECORD_CATEGORIES], [
      'prescription',
      'lab_report',
      'imaging',
      'discharge_summary',
      'other',
    ]);
    assert.equal(categoryLabel('imaging'), 'Imaging / X-rays');
    assert.equal(categoryLabel('discharge_summary'), 'Discharge summaries');
  });

  it('offers "all" plus every category as a filter', () => {
    assert.deepEqual([...RECORD_FILTERS], ['all', ...HEALTH_RECORD_CATEGORIES]);
  });
});

describe('formatRecordDate', () => {
  it('formats a valid date', () => {
    assert.equal(formatRecordDate('2026-03-12'), '12 Mar 2026');
  });

  it('says "No date" for missing, malformed or impossible dates', () => {
    for (const bad of [null, '', 'yesterday', '2026-13-01', '2026-02-30', '12/03/2026']) {
      assert.equal(formatRecordDate(bad), 'No date');
    }
  });
});

describe('sortRecords', () => {
  it('puts the newest first and undated records last, without changing the input', () => {
    const input = [
      record('old', 'other', '2025-01-01'),
      record('none', 'other', null, 'B'),
      record('new', 'other', '2026-05-05'),
      record('none2', 'other', null, 'A'),
    ];
    const before = [...input];
    assert.deepEqual(sortRecords(input).map((r) => r.id), ['new', 'old', 'none2', 'none']);
    assert.deepEqual(input, before);
  });
});

describe('filtering and counting', () => {
  const records = [record('a', 'prescription', '2026-01-01'), record('b', 'lab_report', '2026-01-02'), record('c', 'lab_report', null)];

  it('shows everything for "all" and only the matching category otherwise', () => {
    assert.equal(filterRecords(records, 'all').length, 3);
    assert.deepEqual(filterRecords(records, 'lab_report').map((r) => r.id), ['b', 'c']);
    assert.equal(filterRecords(records, 'imaging').length, 0);
  });

  it('counts every category, including empty ones', () => {
    assert.deepEqual(countByFilter(records), {
      all: 3,
      prescription: 1,
      lab_report: 2,
      imaging: 0,
      discharge_summary: 0,
      other: 0,
    });
  });
});

describe('emptyMessageFor', () => {
  it('explains an empty account differently from an empty category', () => {
    assert.match(emptyMessageFor('all', 0), /No health records yet/);
    assert.match(emptyMessageFor('imaging', 4), /No imaging \/ x-rays yet/);
  });
});

describe('records permission', () => {
  it('lets patients see their own records, but not caregivers', () => {
    assert.ok(policyFor('patient').can('records.view'));
    assert.equal(policyFor('caregiver').can('records.view'), false);
  });
});

describe('DemoHealthRecordService', () => {
  it('uses the same id the demo patient really signs in with', async () => {
    const auth = new DemoAuthService(0);
    const patient = await auth.signIn('patient@demo.test', 'demo1234');
    assert.equal(patient.id, DEMO_PATIENT_ID);
  });

  it('gives the demo patient records in every category except "other", including an undated one', async () => {
    const records = await new DemoHealthRecordService(undefined, 0).list(DEMO_PATIENT_ID);
    assert.equal(records.length, DEMO_RECORDS.length);
    assert.ok(records.some((r) => r.recordedOn === null));
    const counts = countByFilter(records);
    assert.ok(counts.prescription > 0 && counts.lab_report > 0 && counts.imaging > 0 && counts.discharge_summary > 0);
  });

  it('never shows one person the records of another', async () => {
    const service = new DemoHealthRecordService(undefined, 0);
    assert.deepEqual(await service.list('demo-caregiver@demo.test'), []);
    assert.deepEqual(await service.list('someone-else'), []);
  });
});

describe('EmptyHealthRecordService', () => {
  it('always returns an empty list until a real backend exists', async () => {
    assert.deepEqual(await new EmptyHealthRecordService().list('anyone'), []);
  });
});
