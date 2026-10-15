import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { policyFor } from '../src/application/policies/policyFor';
import { profileSectionsFor } from '../src/application/profileSections';

describe('profileSectionsFor', () => {
  it('shows patients their caregivers and reminder notifications, but not missed-dose alerts', () => {
    assert.deepEqual(profileSectionsFor(policyFor('patient')), {
      caregiverContacts: true,
      reminderNotifications: true,
      missedDoseAlerts: false,
    });
  });

  it('shows caregivers missed-dose alert choices, but not a patient\'s caregiver contacts', () => {
    assert.deepEqual(profileSectionsFor(policyFor('caregiver')), {
      caregiverContacts: false,
      reminderNotifications: false,
      missedDoseAlerts: true,
    });
  });
});
