import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { dosesFor, patientsOf } from '../../application/caregiverDoses';
import { formatTime, reminderStatus } from '../../application/reminders';
import type { PatientDose } from '../../domain/entities/PatientDose';
import type { CaregiverDosesStatus } from '../hooks/useCaregiverDoses';
import { colors, radius, spacing } from '../theme/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { FilterChips } from './FilterChips';
import { StatusPill } from './StatusPill';
import { InlineLoading } from './InlineLoading';

interface Props {
  status: CaregiverDosesStatus;
  doses: readonly PatientDose[];
  message: string;
  retry: () => void;
  now: Date;
}

/** Today's doses for the people a caregiver looks after. Read only: there is nothing to confirm here. */
export function CaregiverDoses({ status, doses, message, retry, now }: Props) {
  const [picked, setPicked] = useState<string>('all');
  const patients = useMemo(() => patientsOf(doses), [doses]);
  // A patient who is no longer in the list (a new day, a removed link) falls back to everyone.
  const patientId = patients.some((p) => p.id === picked) ? picked : null;
  const shown = useMemo(() => dosesFor(doses, patientId), [doses, patientId]);

  return (
    <View style={styles.wrapper}>
      <AppText variant="heading" style={styles.title}>
        Today's doses
      </AppText>

      {status === 'loading' ? (
        <InlineLoading label="Loading…" />
      ) : null}

      {status === 'error' ? (
        <>
          <Banner tone="error">{message}</Banner>
          <Button label="Try again" variant="secondary" onPress={retry} />
        </>
      ) : null}

      {status === 'ready' && doses.length === 0 ? (
        <AppText color={colors.inkSoft}>No doses today for the people you care for.</AppText>
      ) : null}

      {status === 'ready' && patients.length > 1 ? (
        <FilterChips
          accessibilityLabel="Show doses for"
          selected={patientId ?? 'all'}
          onSelect={setPicked}
          options={[{ value: 'all', label: 'Everyone' }, ...patients.map((p) => ({ value: p.id, label: p.name }))]}
        />
      ) : null}

      {status === 'ready'
        ? shown.map((dose) => {
            const state = reminderStatus(dose, now);
            return (
              <View key={dose.id} style={[styles.row, state === 'missed' ? styles.missed : null]}>
                <View style={styles.text}>
                  <AppText variant="heading">{dose.patientName}</AppText>
                  <AppText>{dose.medicineName}</AppText>
                  <AppText variant="caption" color={colors.inkSoft}>
                    {formatTime(dose.scheduledAt)}
                  </AppText>
                </View>
                <StatusPill status={state} />
              </View>
            );
          })
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginTop: spacing.lg, gap: spacing.sm },
  title: { marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.paper,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
  },
  // A missed dose has a red edge as well as the word "Missed", so it stands out.
  missed: { borderColor: colors.danger, borderWidth: 2 },
  text: { flex: 1, minWidth: 0, gap: spacing.xs },
});
