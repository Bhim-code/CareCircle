import React from 'react';
import { StyleSheet, View } from 'react-native';
import { STATUS_LABEL } from '../../application/reminders';
import type { ReminderStatus } from '../../domain/entities/Reminder';
import { colors, radius, spacing } from '../theme/theme';
import { AppText } from './AppText';

// The word is always shown, so the meaning never depends on colour alone.
const LOOK: Record<ReminderStatus, { background: string; text: string }> = {
  upcoming: { background: colors.tint, text: colors.harbor },
  due: { background: colors.amberTint, text: colors.amber },
  acknowledged: { background: colors.successTint, text: colors.success },
  missed: { background: colors.dangerTint, text: colors.danger },
};

/** A small coloured label such as "Due now" or "Missed". */
export function StatusPill({ status }: { status: ReminderStatus }) {
  const look = LOOK[status];
  return (
    <View style={[styles.pill, { backgroundColor: look.background }]}>
      <AppText variant="caption" color={look.text} style={styles.text}>
        {STATUS_LABEL[status]}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
  },
  text: { fontWeight: '700' },
});
