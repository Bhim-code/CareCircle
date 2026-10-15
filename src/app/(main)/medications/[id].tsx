import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  canAcknowledge,
  formatTime,
  reminderStatus,
  STATUS_HELP,
} from '@/application/reminders';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { Can } from '@/presentation/components/Can';
import { Card } from '@/presentation/components/Card';
import { Screen } from '@/presentation/components/Screen';
import { StatusPill } from '@/presentation/components/StatusPill';
import { TextLink } from '@/presentation/components/TextLink';
import { useNow } from '@/presentation/hooks/useNow';
import { useTodaysReminders } from '@/presentation/providers/RemindersProvider';
import { colors, spacing } from '@/presentation/theme/theme';

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/medications');
}

export default function ReminderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const now = useNow();
  const { status, reminders, retry, acknowledge } = useTodaysReminders();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const reminder = reminders.find((item) => item.id === id);

  async function handleConfirm() {
    if (!reminder) return;
    setSaving(true);
    setFailed(false);
    const saved = await acknowledge(reminder.id);
    setFailed(!saved);
    setSaving(false);
  }

  return (
    <Screen>
      <View style={styles.back}>
        <TextLink label="‹ Back" onPress={goBack} />
      </View>

      {status === 'loading' ? (
        <AppText color={colors.inkSoft} accessibilityLiveRegion="polite">
          Loading…
        </AppText>
      ) : status === 'error' ? (
        <>
          <Banner tone="error">We could not load this reminder. Please try again.</Banner>
          <Button label="Try again" variant="secondary" onPress={retry} />
        </>
      ) : !reminder ? (
        <Card title="Reminder not found">
          <AppText color={colors.inkSoft}>This reminder is no longer available.</AppText>
        </Card>
      ) : (
        <ReminderDetails
          name={reminder.medicineName}
          time={formatTime(reminder.scheduledAt)}
          state={reminderStatus(reminder, now)}
          saving={saving}
          failed={failed}
          onConfirm={handleConfirm}
        />
      )}
    </Screen>
  );
}

interface DetailsProps {
  name: string;
  time: string;
  state: ReturnType<typeof reminderStatus>;
  saving: boolean;
  failed: boolean;
  onConfirm: () => void;
}

function ReminderDetails({ name, time, state, saving, failed, onConfirm }: DetailsProps) {
  return (
    <>
      <AppText variant="title" style={styles.title}>
        {name}
      </AppText>
      <AppText color={colors.inkSoft} style={styles.time}>
        Today at {time}
      </AppText>
      <StatusPill status={state} />
      <AppText style={styles.help}>{STATUS_HELP[state]}</AppText>

      {failed ? <Banner tone="error">We could not save that. Please try again.</Banner> : null}

      {/* A dose is only ever marked as taken by this button. */}
      <Can permission="reminders.acknowledge">
        {canAcknowledge(state) ? (
          <Button label="I took it" onPress={onConfirm} loading={saving} />
        ) : null}
      </Can>
    </>
  );
}

const styles = StyleSheet.create({
  back: { alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, marginBottom: spacing.xs },
  time: { marginBottom: spacing.md },
  help: { marginTop: spacing.lg, marginBottom: spacing.lg },
});
