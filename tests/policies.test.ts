import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { policyFor } from '../src/application/policies/policyFor';
import { ROLES } from '../src/domain/entities/Role';

describe('role policies', () => {
  it('gives every role a policy that reports its own role', () => {
    for (const role of ROLES) assert.equal(policyFor(role).role, role);
  });

  it('lets patients manage reminders and caregivers, but not receive alerts', () => {
    const patient = policyFor('patient');
    assert.ok(patient.can('reminders.manage'));
    assert.ok(patient.can('reminders.acknowledge'));
    assert.ok(patient.can('caregivers.manage'));
    assert.equal(patient.can('alerts.receive'), false);
    assert.equal(patient.can('patients.monitor'), false);
  });

  it('lets caregivers receive alerts and monitor, but not manage reminders', () => {
    const caregiver = policyFor('caregiver');
    assert.ok(caregiver.can('alerts.receive'));
    assert.ok(caregiver.can('patients.monitor'));
    assert.equal(caregiver.can('reminders.manage'), false);
    assert.equal(caregiver.can('caregivers.manage'), false);
  });
});
