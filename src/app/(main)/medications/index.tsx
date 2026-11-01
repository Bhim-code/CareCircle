import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { isMedicineActive, medicineDatesText, scheduleText, sortMedicines } from '@/application/medicines';
import { dayKey, formatDate, formatTime, reminderStatus, sortByTime, STATUS_LABEL } from '@/application/reminders';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { Can } from '@/presentation/components/Can';
import { Card } from '@/presentation/components/Card';
import { Screen } from '@/presentation/components/Screen';
import { StatusPill } from '@/presentation/components/StatusPill';
import { useNow } from '@/presentation/hooks/useNow';
import { useMedicineList } from '@/presentation/providers/MedicinesProvider';
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
        <MyMedicines />
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

function MyMedicines() {
  const now = useNow();
  const { status, medicines, retry, stop } = useMedicineList();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const today = dayKey(now);

  async function handleStop(id: string) {
    setStoppingId(id);
    setFailure(null);
    const result = await stop(id);
    setStoppingId(null);
    setConfirming(null);
    if (!result.ok) setFailure(result.message);
  }

  return (
    <View style={styles.section}>
      <AppText variant="heading" style={styles.sectionTitle}>
        My medicines
      </AppText>
      <Button label="Add a medicine" onPress={() => router.push('/medications/add')} />

      {failure ? <Banner tone="error">{failure}</Banner> : null}

      {status === 'loading' ? (
        <AppText color={colors.inkSoft} accessibilityLiveRegion="polite">
          Loading your medicines…
        </AppText>
      ) : null}
      {status === 'error' ? (
        <>
          <Banner tone="error">We could not load your medicines. Please try again.</Banner>
          <Button label="Try again" variant="secondary" onPress={retry} />
        </>
      ) : null}
      {status === 'ready' && medicines.length === 0 ? (
        <AppText color={colors.inkSoft}>You have not added any medicines yet.</AppText>
      ) : null}

      {status === 'ready'
        ? sortMedicines(medicines, today).map((medicine) => {
            const active = isMedicineActive(medicine, today);
            return (
              <View key={medicine.id} style={[styles.medicine, !active && styles.inactive]}>
                <AppText variant="heading">{medicine.name}</AppText>
                <AppText>{scheduleText(medicine.times)}</AppText>
                <AppText color={colors.inkSoft}>{medicineDatesText(medicine, today)}</AppText>
                {active ? (
                  confirming === medicine.id ? (
                    <View style={styles.confirm}>
                      <AppText variant="label">Stop {medicine.name}? You will no longer get reminders for it.</AppText>
                      <Button
                        label="Yes, stop it"
                        variant="danger"
                        loading={stoppingId === medicine.id}
                        onPress={() => handleStop(medicine.id)}
                      />
                      <Button label="Keep it" variant="secondary" onPress={() => setConfirming(null)} />
                    </View>
                  ) : (
                    <Button label={`Stop ${medicine.name}`} variant="secondary" onPress={() => setConfirming(medicine.id)} />
                  )
                ) : null}
              </View>
            );
          })
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.xl, gap: spacing.md },
  sectionTitle: { marginBottom: spacing.xs },
  medicine: {
    backgroundColor: colors.paper,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  inactive: { opacity: 0.7 },
  confirm: { gap: spacing.sm },
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
