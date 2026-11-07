import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  canUndo,
  isOpen,
  sortTasks,
  summaryText,
  taskTimeText,
  validateSkip,
} from '@/application/careTasks';
import { TASKS_COMPLETE, TASKS_VIEW } from '@/application/permissions';
import { usePermission } from '@/presentation/hooks/usePermission';
import { formatDate, formatTime } from '@/application/reminders';
import type { ClientDay, TaskItem } from '@/domain/entities/CareTask';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { Screen } from '@/presentation/components/Screen';
import { TaskStatusPill } from '@/presentation/components/TaskStatusPill';
import { TextField } from '@/presentation/components/TextField';
import { useNow } from '@/presentation/hooks/useNow';
import { useAuth } from '@/presentation/providers/AuthProvider';
import { useCareTaskList } from '@/presentation/providers/CareTasksProvider';
import { colors, radius, spacing } from '@/presentation/theme/theme';

export default function TasksScreen() {
  const now = useNow();
  const { user } = useAuth();
  const canView = usePermission(TASKS_VIEW);

  return (
    <Screen>
      <AppText variant="title" style={styles.title}>
        Today's tasks
      </AppText>
      <AppText color={colors.inkSoft} style={styles.date}>
        {formatDate(now)}
      </AppText>
      {canView ? (
        <TaskLists />
      ) : (
        <Banner tone="info">Your account cannot see care tasks. Ask a supervisor if you need them.</Banner>
      )}
    </Screen>
  );
}

function TaskLists() {
  const { user } = useAuth();
  const { status, days, retry } = useCareTaskList();
  const canComplete = usePermission(TASKS_COMPLETE);

  if (status === 'loading') {
    return (
      <AppText color={colors.inkSoft} accessibilityLiveRegion="polite">
        Loading the tasks…
      </AppText>
    );
  }
  if (status === 'error') {
    return (
      <>
        <Banner tone="error">We could not load the tasks. Please try again.</Banner>
        <Button label="Try again" variant="secondary" onPress={retry} />
      </>
    );
  }
  if (days.length === 0) {
    return <AppText color={colors.inkSoft}>No tasks yet. A supervisor plans them for each client.</AppText>;
  }
  return (
    <>
      {days.map((day) => (
        <ClientSection key={day.client.id} day={day} canComplete={canComplete} showName={days.length > 1 || user?.role === 'caregiver'} />
      ))}
      <View style={styles.refresh}>
        <RefreshButton />
      </View>
    </>
  );
}

function RefreshButton() {
  const { refresh, refreshing } = useCareTaskList();
  return <Button label="Refresh" variant="secondary" onPress={refresh} loading={refreshing} />;
}

function ClientSection({ day, canComplete, showName }: { day: ClientDay; canComplete: boolean; showName: boolean }) {
  const total = day.tasks.length;
  return (
    <View style={styles.section}>
      {showName ? (
        <AppText variant="heading" accessibilityRole="header">
          {day.client.name}
        </AppText>
      ) : null}
      <AppText color={colors.inkSoft}>{summaryText(day.counts, total)}</AppText>

      {total === 0 ? <AppText color={colors.inkSoft}>Nothing is planned for this day.</AppText> : null}
      {sortTasks(day.tasks).map((task) => (
        <TaskCard key={task.taskId} task={task} day={day.day} canComplete={canComplete} />
      ))}

      {day.extras.length > 0 ? (
        <View style={styles.extras}>
          <AppText variant="label">Extra work</AppText>
          {day.extras.map((extra) => (
            <View key={extra.id} style={styles.extra}>
              <AppText>{extra.title}</AppText>
              <AppText variant="caption" color={colors.inkSoft}>
                {extra.doneBy.name} at {formatTime(extra.doneAt)}
                {extra.note ? ` · ${extra.note}` : ''}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {canComplete ? (
        <Button
          label="Log extra work"
          variant="secondary"
          onPress={() => router.push({ pathname: '/tasks/extra', params: { clientId: day.client.id, clientName: day.client.name } })}
        />
      ) : null}
    </View>
  );
}

function TaskCard({ task, day, canComplete }: { task: TaskItem; day: string; canComplete: boolean }) {
  const now = useNow();
  const { user } = useAuth();
  const { mark, undo } = useCareTaskList();
  const [busy, setBusy] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setBusy(true);
    setFailure(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setFailure(result.message);
    else {
      setSkipping(false);
      setReason('');
    }
  }

  function handleSkip() {
    const check = validateSkip(reason, '');
    if (!check.ok) {
      setReasonError(check.error);
      return;
    }
    setReasonError(undefined);
    void run(() => mark(task.taskId, day, check.input));
  }

  const open = isOpen(task.status);
  const mine = user ? canUndo(task, user.id, now) : false;

  return (
    <View style={styles.card} accessibilityLabel={`${task.title}, ${taskTimeText(task.time)}`}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitle}>
          <AppText variant="heading">{task.title}</AppText>
          <AppText color={colors.inkSoft}>{taskTimeText(task.time)}</AppText>
        </View>
        <TaskStatusPill status={task.status} />
      </View>

      {task.instructions ? <AppText color={colors.inkSoft}>{task.instructions}</AppText> : null}

      {task.mark ? (
        <AppText variant="caption" color={colors.inkSoft}>
          {task.mark.status === 'skipped' ? 'Skipped' : 'Marked done'} by {task.mark.doneBy.name} at {formatTime(task.mark.doneAt)}
          {task.mark.reason ? `. Reason: ${task.mark.reason}` : ''}
          {task.mark.note ? `. Note: ${task.mark.note}` : ''}
        </AppText>
      ) : null}

      {failure ? <Banner tone="error">{failure}</Banner> : null}

      {canComplete && open && !skipping ? (
        <View style={styles.actions}>
          <Button label="Mark done" onPress={() => void run(() => mark(task.taskId, day, { status: 'done' }))} loading={busy} />
          <Button label="Skip" variant="secondary" onPress={() => setSkipping(true)} disabled={busy} />
        </View>
      ) : null}

      {canComplete && open && skipping ? (
        <View style={styles.actions}>
          <TextField
            label="Why is it skipped?"
            value={reason}
            onChangeText={(text) => {
              setReason(text);
              setReasonError(undefined);
            }}
            error={reasonError}
            placeholder="For example: Ana was resting"
            maxLength={200}
          />
          <Button label="Save skip" variant="danger" onPress={handleSkip} loading={busy} />
          <Button
            label="Cancel"
            variant="secondary"
            onPress={() => {
              setSkipping(false);
              setReasonError(undefined);
            }}
            disabled={busy}
          />
        </View>
      ) : null}

      {canComplete && mine ? (
        <Button label="Undo" variant="secondary" onPress={() => void run(() => undo(task.taskId, day))} loading={busy} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: spacing.sm, marginBottom: spacing.xs },
  date: { marginBottom: spacing.lg },
  section: { gap: spacing.md, marginBottom: spacing.xl },
  card: {
    backgroundColor: colors.paper,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  cardTitle: { flex: 1, gap: spacing.xs },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
  extras: { gap: spacing.sm },
  extra: { backgroundColor: colors.paper, borderRadius: radius.field, borderWidth: 1, borderColor: colors.line, padding: spacing.md, gap: spacing.xs },
  refresh: { marginBottom: spacing.lg },
});
