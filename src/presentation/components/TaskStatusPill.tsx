import React from 'react';
import { StyleSheet, View } from 'react-native';
import { TASK_STATUS_LABEL } from '../../application/careTasks';
import type { TaskStatus } from '../../domain/entities/CareTask';
import { colors, radius, spacing } from '../theme/theme';
import { AppText } from './AppText';

// The word is always shown, so the meaning never depends on colour alone.
const LOOK: Record<TaskStatus, { background: string; text: string }> = {
  upcoming: { background: colors.tint, text: colors.harbor },
  due: { background: colors.amberTint, text: colors.amber },
  done: { background: colors.successTint, text: colors.success },
  late: { background: colors.successTint, text: colors.success },
  skipped: { background: colors.tint, text: colors.inkSoft },
  missed: { background: colors.dangerTint, text: colors.danger },
};

/** A small coloured label such as "Due now" or "Missed" for a care task. */
export function TaskStatusPill({ status }: { status: TaskStatus }) {
  const look = LOOK[status];
  return (
    <View style={[styles.pill, { backgroundColor: look.background }]}>
      <AppText variant="caption" color={look.text} style={styles.text}>
        {TASK_STATUS_LABEL[status]}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs },
  text: { fontWeight: '700' },
});
