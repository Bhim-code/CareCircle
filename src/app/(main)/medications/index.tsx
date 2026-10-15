import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatDate, formatTime, reminderStatus, sortByTime, STATUS_LABEL } from '@/application/reminders';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { Can } from '@/presentation/components/Can';
import { Card } from '@/presentation/components/Card';
import { Screen } from '@/presentation/components/Screen';
import { StatusPill } from '@/presentation/components/StatusPill';
import { useNow } from '@/presentation/hooks/useNow';
import { useTodaysReminders } from '@/presentation/providers/RemindersProvider';
import { colors, radius, spacing } from '@/presentation/theme/theme';

export default function MedicationsScreen() {
  const now = useNow();

  return (
    <Screen>
      <AppText variant="title" style={styles.title}>
        My Medications
      </AppText>
      <AppText color={colors.inkSoft} style={styles.date}>
        Today, {formatDate(now)}
      </AppText>

      {/* Only patients have reminders, so only they get the part that shows them. */}
      <Can permission="reminders.manage" showMessage>
        <ReminderList />
      </Can>
    </Screen>
  );
}

function ReminderList() {
  const now = useNow();
  const { status, reminders, retry } = useTodaysReminders();

  if (status === 'loading') {
    return (
      <AppText color={colors.inkSoft} accessibilityLiveRegion="polite">
        Loading your medicines…
      </AppText>
    );
  }

  if (status === 'error') {
    return (
      <>
        <Banner tone="error">We could not load your medicines. Please try again.</Banner>
        <Button label="Try again" variant="secondary" onPress={retry} />
      </>
    );
  }

  if (reminders.length === 0) {
    return (
      <Card title="Nothing scheduled today">
        <AppText color={colors.inkSoft}>
          When medicines are added, today's reminders will appear here.
        </AppText>
      </Card>
    );
  }

  return (
    <>
      {sortByTime(reminders).map((reminder) => {
        const state = reminderStatus(reminder, now);
        const time = formatTime(reminder.scheduledAt);
        return (
          <Pressable
            key={reminder.id}
            accessibilityRole="button"
            accessibilityLabel={`${reminder.medicineName}, ${time}, ${STATUS_LABEL[state]}. Opens details.`}
            onPress={() => router.push(`/medications/${reminder.id}`)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.rowText}>
              <AppText variant="heading">{reminder.medicineName}</AppText>
              <AppText color={colors.inkSoft}>{time}</AppText>
              <StatusPill status={state} />
            </View>
            <Ionicons name="chevron-forward" size={26} color={colors.inkSoft} />
          </Pressable>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: spacing.sm, marginBottom: spacing.xs },
  date: { marginBottom: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.paper,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  pressed: { backgroundColor: colors.tint },
  rowText: { flex: 1, gap: spacing.xs },
});
