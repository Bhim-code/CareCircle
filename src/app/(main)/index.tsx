import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { firstName, greetingFor } from '@/application/greeting';
import { formatDate, formatTime, dayKey, summarizeToday } from '@/application/reminders';
import { createCaregiverDoseService } from '@/container';
import { AppText } from '@/presentation/components/AppText';
import { AlarmPermissionNotice } from '@/presentation/components/AlarmPermissionNotice';
import { Can } from '@/presentation/components/Can';
import { CaregiverDoses } from '@/presentation/components/CaregiverDoses';
import { ShortcutTile } from '@/presentation/components/ShortcutTile';
import { StatusPill } from '@/presentation/components/StatusPill';
import { TextLink } from '@/presentation/components/TextLink';
import { InlineLoading } from '@/presentation/components/InlineLoading';
import { useCaregiverDoses } from '@/presentation/hooks/useCaregiverDoses';
import { useNow } from '@/presentation/hooks/useNow';
import { useAuth } from '@/presentation/providers/AuthProvider';
import { useTextScale } from '@/presentation/providers/PreferencesProvider';
import { useTodaysReminders } from '@/presentation/providers/RemindersProvider';
import { colors, radius, roleAccent, spacing } from '@/presentation/theme/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** One short notice with an icon, shown under "Your updates". */
function Update({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <View style={styles.update}>
      <View style={styles.updateIcon}>
        <Ionicons name={icon} size={26} color={colors.harbor} />
      </View>
      <View style={styles.updateText}>
        <AppText variant="label">{title}</AppText>
        <AppText color={colors.inkSoft}>{text}</AppText>
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const { user, policy } = useAuth();
  const insets = useSafeAreaInsets();
  const textScale = useTextScale();
  const now = useNow();

  // Patients see their reminders; caregivers see the people they look after.
  const isPatient = policy?.can('reminders.manage') ?? false;

  // Only the signed-in patient's own reminders, for today only (see RemindersProvider).
  const { status, reminders, retry } = useTodaysReminders();
  const today = summarizeToday(reminders, now);

  // Caregivers see today's doses for the people they look after (read only).
  const isCaregiver = !isPatient && (policy?.can('patients.monitor') ?? false);
  const [doseService] = useState(createCaregiverDoseService);
  const care = useCaregiverDoses(doseService, dayKey(now), isCaregiver);
  const careToday = summarizeToday(care.doses, now);

  // The route guard guarantees both exist; this keeps TypeScript honest.
  if (!user || !policy) return null;

  return (
    <ScrollView style={styles.page} showsVerticalScrollIndicator={false}>
      {/* The band takes the colour of the signed-in role: blue for patients, amber for caregivers. */}
      <View
        style={[
          styles.band,
          { backgroundColor: roleAccent[user.role].background, paddingTop: insets.top + spacing.lg },
        ]}
      >
        <View style={styles.column}>
          <AppText variant="title" style={styles.greeting}>
            {greetingFor(now)}, {firstName(user.name) || 'there'}
          </AppText>
          <AppText color={colors.inkSoft}>
            {formatDate(now)} · {policy.displayName}
          </AppText>
        </View>
      </View>

      <View style={[styles.column, styles.body]}>
        {isPatient ? <AlarmPermissionNotice /> : null}
        <View style={styles.summary}>
          <AppText variant="label" color={colors.inkSoft}>
            {isPatient ? "Today's reminders" : "Today's doses for your patients"}
          </AppText>
          <View style={styles.summaryRow}>
            <AppText variant="title" style={{ fontSize: 48 * textScale, lineHeight: 54 * textScale }}>
              {/* Patients: how many reminders today. Caregivers: how many doses their patients have. */}
              {isPatient ? (status === 'ready' ? today.total : '–') : care.status === 'ready' ? careToday.total : '–'}
            </AppText>
            <AppText color={colors.inkSoft}>{isPatient ? 'scheduled today' : 'across your patients'}</AppText>
          </View>
          {isPatient && status === 'ready' && today.total > 0 ? (
            <AppText variant="caption" color={colors.inkSoft} style={styles.counts}>
              {today.acknowledged} taken · {today.remaining} to go · {today.missed} missed
              {today.skipped > 0 ? ` · ${today.skipped} skipped` : ''}
            </AppText>
          ) : null}
          {!isPatient && care.status === 'ready' && careToday.total > 0 ? (
            <AppText variant="caption" color={colors.inkSoft} style={styles.counts}>
              {careToday.acknowledged} taken · {careToday.remaining} to go · {careToday.missed} missed
              {careToday.skipped > 0 ? ` · ${careToday.skipped} skipped` : ''}
            </AppText>
          ) : null}
          <View style={styles.summaryNote}>
            <Ionicons
              name={isPatient ? 'alarm-outline' : 'notifications-outline'}
              size={24}
              color={colors.harbor}
            />
            <View style={styles.flex}>
              {!isPatient ? (
                care.status === 'loading' ? (
                  <InlineLoading label="Loading your patients' doses…" />
                ) : care.status === 'error' ? (
                  <AppText variant="label">We could not load the doses.</AppText>
                ) : careToday.missed > 0 ? (
                  <AppText variant="label">
                    {careToday.missed === 1 ? '1 missed dose today' : `${careToday.missed} missed doses today`}
                  </AppText>
                ) : (
                  <AppText variant="label">No missed doses right now</AppText>
                )
              ) : status === 'loading' ? (
                <InlineLoading label="Loading your reminders…" />
              ) : status === 'error' ? (
                <>
                  <AppText variant="label">We could not load your reminders.</AppText>
                  <TextLink label="Try again" onPress={retry} />
                </>
              ) : today.next ? (
                <>
                  <AppText variant="caption" color={colors.inkSoft}>
                    Next reminder
                  </AppText>
                  <AppText variant="label">
                    {today.next.reminder.medicineName} · {formatTime(today.next.reminder.scheduledAt)}
                  </AppText>
                  <StatusPill status={today.next.status} />
                </>
              ) : today.total > 0 ? (
                <AppText variant="label">No more reminders today</AppText>
              ) : (
                <AppText variant="label">No reminders yet</AppText>
              )}
            </View>
          </View>
        </View>

        {isCaregiver ? (
          <CaregiverDoses status={care.status} doses={care.doses} message={care.message} retry={care.retry} now={now} />
        ) : null}

        <View style={styles.tiles}>
          <ShortcutTile
            label="Medications"
            icon="medkit-outline"
            tint={colors.tint}
            color={colors.harbor}
            onPress={() => router.navigate('/medications')}
          />
          <ShortcutTile
            label="Health records"
            icon="document-text-outline"
            tint={colors.amberTint}
            color={colors.amber}
            onPress={() => router.navigate('/records')}
          />
          <ShortcutTile
            label="Profile"
            icon="person-outline"
            tint={colors.successTint}
            color={colors.success}
            onPress={() => router.navigate('/profile')}
          />
        </View>

        <AppText variant="heading" style={styles.sectionTitle}>
          Your updates
        </AppText>
        <Can permission="caregivers.manage">
          <Update
            icon="people-outline"
            title="Your caregivers"
            text="Invite a caregiver, or see who has accepted, in Profile > Manage my caregivers."
          />
        </Can>
        <Can permission="alerts.receive">
          <Update
            icon="notifications-outline"
            title="No alerts right now"
            text="You will be notified here if someone misses a reminder."
          />
        </Can>
        <Can permission="patients.monitor">
          <Update
            icon="person-add-outline"
            title="Your clients"
            text="Accept invitations and see who you care for in Profile > See my clients and invitations."
          />
        </Can>

        <AppText variant="caption" color={colors.inkSoft} style={styles.notice}>
          CareCircle does not replace emergency services. In an emergency, call 911 or your local
          emergency number.
        </AppText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: colors.mist },
  // The coloured strip across the top. The summary card overlaps its bottom edge.
  band: { paddingBottom: spacing.xxl },
  column: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: spacing.lg },
  greeting: { marginBottom: spacing.xs },
  body: { marginTop: -spacing.xl, paddingBottom: spacing.xl },
  summary: {
    backgroundColor: colors.paper,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    boxShadow: '0px 4px 12px rgba(20, 35, 43, 0.08)',
  },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginVertical: spacing.sm },
  counts: { marginBottom: spacing.md },
  summaryNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.mist,
    borderRadius: radius.field,
    padding: spacing.md,
  },
  tiles: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  sectionTitle: { marginTop: spacing.xl, marginBottom: spacing.md },
  update: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.paper,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  updateText: { flex: 1, gap: spacing.xs },
  updateIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: { marginTop: spacing.lg, textAlign: 'center' },
});
