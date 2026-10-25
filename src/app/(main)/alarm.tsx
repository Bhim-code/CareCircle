import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { isTestReminder } from '@/application/alarmActions';
import { remainingRingSeconds } from '@/application/alarmPlan';
import { formatTime } from '@/application/reminders';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { Screen } from '@/presentation/components/Screen';
import { useAlarmSound } from '@/presentation/hooks/useAlarmSound';
import { useAlarms, type AlarmOutcome } from '@/presentation/providers/AlarmProvider';
import { useTodaysReminders } from '@/presentation/providers/RemindersProvider';
import { colors, spacing } from '@/presentation/theme/theme';

const DONE_TEXT: Record<AlarmOutcome, string> = {
  taken: 'Saved. You took this medicine.',
  skipped: 'Saved. You skipped this dose.',
  snoozed: 'Okay. We will remind you again soon.',
};

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * Opened by an alarm. Big text and three big buttons, so it can be used
 * without reading anything small.
 */
export default function AlarmScreen() {
  const params = useLocalSearchParams<{ id?: string; name?: string; done?: AlarmOutcome; t?: string; fire?: string }>();
  const { reminders } = useTodaysReminders();
  const { takeIt, skipIt, snoozeIt, snoozeMinutes } = useAlarms();
  const [busy, setBusy] = useState<AlarmOutcome | null>(null);
  const [outcome, setOutcome] = useState<AlarmOutcome | null>(params.done ?? null);
  const [failed, setFailed] = useState(false);

  // This screen stays mounted between alarms, so start fresh every time one opens it.
  useEffect(() => {
    setOutcome(params.done ?? null);
    setFailed(false);
    setBusy(null);
  }, [params.id, params.done, params.t]);

  const id = params.id ?? '';
  const reminder = reminders.find((item) => item.id === id);
  const name = reminder?.medicineName ?? params.name ?? 'your medicine';
  const answered = Boolean(reminder?.acknowledged || reminder?.skipped);
  const known = Boolean(reminder) || isTestReminder(id);

  // The alarm sound loops while the dose is unanswered and the 2 minutes have not run out.
  const ringing = known && !answered && outcome === null;
  const ringSeconds = ringing
    ? remainingRingSeconds(params.fire ? Number(params.fire) : null, Date.now())
    : 0;
  useAlarmSound(ringSeconds, `${id}:${params.t ?? ''}`);

  async function run(kind: AlarmOutcome) {
    setBusy(kind);
    setFailed(false);
    const worked =
      kind === 'taken' ? await takeIt(id) : kind === 'skipped' ? await skipIt(id) : await snoozeIt(id, name);
    setBusy(null);
    if (worked) setOutcome(kind);
    else setFailed(true);
  }

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="label" color={colors.inkSoft}>
          {isTestReminder(id) ? 'Test alarm' : 'Medicine reminder'}
        </AppText>
        <AppText variant="title">Time for your medicine</AppText>
        <AppText style={styles.name}>{name}</AppText>
        {reminder ? (
          <AppText color={colors.inkSoft}>Due at {formatTime(reminder.scheduledAt)}</AppText>
        ) : null}
      </View>

      {outcome ? (
        <>
          <Banner tone="success">{DONE_TEXT[outcome]}</Banner>
          <View style={styles.buttons}>
            <Button label="Done" onPress={leave} />
          </View>
        </>
      ) : !known ? (
        <>
          <Banner tone="info">This reminder is not on today's list any more.</Banner>
          <View style={styles.buttons}>
            <Button label="Back to home" onPress={leave} />
          </View>
        </>
      ) : answered ? (
        <>
          <Banner tone="info">You have already answered this one.</Banner>
          <View style={styles.buttons}>
            <Button label="Back to home" onPress={leave} />
          </View>
        </>
      ) : (
        <>
          {failed ? <Banner tone="error">We could not save that. Please try again.</Banner> : null}
          <View style={styles.buttons}>
            <Button label="I took it" onPress={() => void run('taken')} loading={busy === 'taken'} />
            <Button
              label={`Snooze ${snoozeMinutes} minutes`}
              variant="secondary"
              onPress={() => void run('snoozed')}
              loading={busy === 'snoozed'}
            />
            <Button
              label="Skip this dose"
              variant="danger"
              onPress={() => void run('skipped')}
              loading={busy === 'skipped'}
            />
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm, marginTop: spacing.xl, marginBottom: spacing.xl },
  name: { fontSize: 32, lineHeight: 40, fontWeight: '700' },
  buttons: { gap: spacing.md, marginTop: spacing.lg },
});
