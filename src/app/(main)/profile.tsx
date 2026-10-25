import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { formatTime } from '@/application/reminders';
import { profileSectionsFor } from '@/application/profileSections';
import { env } from '@/config/env';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { FilterChips } from '@/presentation/components/FilterChips';
import { Card } from '@/presentation/components/Card';
import { RoleBadge } from '@/presentation/components/RoleBadge';
import { Screen } from '@/presentation/components/Screen';
import { ToggleRow } from '@/presentation/components/ToggleRow';
import { useSubmit } from '@/presentation/hooks/useSubmit';
import { useAlarms } from '@/presentation/providers/AlarmProvider';
import { useAuth } from '@/presentation/providers/AuthProvider';
import { SNOOZE_CHOICES } from '@/domain/entities/UserPreferences';
import { usePreferences } from '@/presentation/providers/PreferencesProvider';
import { colors, roleAccent, spacing } from '@/presentation/theme/theme';

/** One label and its value, e.g. "Email" and the address. */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <AppText variant="caption" color={colors.inkSoft}>
        {label}
      </AppText>
      <AppText>{value}</AppText>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, policy, signOut } = useAuth();
  const { preferences, saveFailed, update } = usePreferences();
  const { loading, run } = useSubmit();
  const { permission, askForPermission, sendTestAlarm } = useAlarms();
  // The test alarm button: idle, working while it is being set, then "set" until it has rung.
  const [testRingsAt, setTestRingsAt] = useState<Date | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testFailed, setTestFailed] = useState(false);

  useEffect(() => {
    if (!testRingsAt) return;
    // Let the button be used again shortly after the test alarm has rung.
    const wait = Math.max(testRingsAt.getTime() - Date.now(), 0) + 5000;
    const timer = setTimeout(() => setTestRingsAt(null), wait);
    return () => clearTimeout(timer);
  }, [testRingsAt]);

  async function handleTestAlarm() {
    setTestBusy(true);
    setTestFailed(false);
    try {
      setTestRingsAt(await sendTestAlarm());
    } catch {
      setTestFailed(true);
    }
    setTestBusy(false);
  }

  // The route guard guarantees both exist; this keeps TypeScript honest.
  if (!user || !policy) return null;

  const accent = roleAccent[user.role].foreground;
  const sections = profileSectionsFor(policy);
  const hasNotificationChoices = sections.reminderNotifications || sections.missedDoseAlerts;

  return (
    <Screen>
      <View style={styles.header}>
        <RoleBadge role={user.role} label={policy.displayName} />
        <AppText variant="title">Profile</AppText>
      </View>

      {saveFailed ? <Banner tone="error">We could not save that change. Please try again.</Banner> : null}

      <Card title="Your details" accent={accent}>
        <DetailRow label="Name" value={user.name || 'Not set'} />
        <DetailRow label="Email" value={user.email} />
        <DetailRow label="Account type" value={policy.displayName} />
      </Card>

      {sections.caregiverContacts ? (
        <Card title="Your caregivers" accent={accent}>
          <AppText color={colors.inkSoft}>
            No one has been added yet. Contact details for caregivers you add will appear here, and
            only you can see them.
          </AppText>
        </Card>
      ) : null}

      {hasNotificationChoices ? (
        <Card title="Notifications" accent={accent}>
          {sections.reminderNotifications ? (
            <ToggleRow
              label="Medicine alarms"
              description="Rings on this phone when a medicine is due, and again 5 and 10 minutes later until you answer."
              value={preferences.reminderNotifications}
              onValueChange={(value) => update({ reminderNotifications: value })}
            />
          ) : null}
          {sections.reminderNotifications && preferences.reminderNotifications ? (
            <>
              <ToggleRow
                label="Alarm sound"
                description="Plays a sound for each ring."
                value={preferences.alarmSound}
                onValueChange={(value) => update({ alarmSound: value })}
              />
              <ToggleRow
                label="Vibration"
                description="Vibrates the phone for each ring. On an iPhone this follows the phone's own settings."
                value={preferences.alarmVibration}
                onValueChange={(value) => update({ alarmVibration: value })}
              />
              <AppText variant="label" style={styles.snoozeLabel}>
                Snooze for
              </AppText>
              <FilterChips
                accessibilityLabel="Snooze length"
                options={SNOOZE_CHOICES.map((minutes) => ({ value: String(minutes), label: `${minutes} min` }))}
                selected={String(preferences.snoozeMinutes)}
                onSelect={(value) => update({ snoozeMinutes: Number(value) })}
              />
              {permission === 'denied' || permission === 'undetermined' ? (
                <View style={styles.support}>
                  <Banner tone="error">This phone has not allowed notifications for CareCircle yet.</Banner>
                  <Button
                    label={permission === 'denied' ? 'Open phone settings' : 'Allow medicine alarms'}
                    onPress={() => void askForPermission()}
                  />
                </View>
              ) : null}
              {__DEV__ && permission === 'granted' ? (
                <View style={styles.support}>
                  <Button
                    label={testRingsAt ? '✓ Test alarm set' : 'Try an alarm (rings in 30 seconds)'}
                    variant="secondary"
                    loading={testBusy}
                    disabled={testBusy || testRingsAt !== null}
                    onPress={() => void handleTestAlarm()}
                  />
                  {testRingsAt ? (
                    <Banner tone="success">
                      {`✓ Test alarm set. It will ring at ${formatTime(testRingsAt.toISOString())} (in about 30 seconds). Lock the phone or leave the app and wait.`}
                    </Banner>
                  ) : null}
                  {testFailed ? <Banner tone="error">We could not set the test alarm. Please try again.</Banner> : null}
                </View>
              ) : null}
            </>
          ) : null}
          {sections.missedDoseAlerts ? (
            <>
              <ToggleRow
                label="Email me about missed doses"
                description="When someone you care for does not confirm a dose."
                value={preferences.missedDoseEmail}
                onValueChange={(value) => update({ missedDoseEmail: value })}
              />
              <ToggleRow
                label="Phone me about missed doses"
                description="A phone call, if the dose is still not confirmed."
                value={preferences.missedDoseCall}
                onValueChange={(value) => update({ missedDoseCall: value })}
              />
            </>
          ) : null}
          <AppText variant="caption" color={colors.inkSoft} style={styles.note}>
            These choices are saved on this phone. Caregiver alerts are not switched on yet.
          </AppText>
        </Card>
      ) : null}

      <Card title="Accessibility" accent={accent}>
        <ToggleRow
          label="Larger text"
          description="Makes the words in CareCircle bigger."
          value={preferences.largerText}
          onValueChange={(value) => update({ largerText: value })}
        />
        <AppText variant="caption" color={colors.inkSoft} style={styles.note}>
          CareCircle also follows the text size you set in your phone's settings.
        </AppText>
      </Card>

      <Card title="Help and support" accent={accent}>
        <DetailRow
          label="What if I miss a reminder?"
          value="Once reminders are on, the caregivers linked to a patient are told when a dose is not confirmed, so someone can check on them."
        />
        <DetailRow
          label="Who can see my information?"
          value="Only you, and people you choose to add. This page shows only your own details."
        />
        {env.supportEmail ? (
          <View style={styles.support}>
            <Button
              label="Email support"
              variant="secondary"
              onPress={() => void Linking.openURL(`mailto:${env.supportEmail}`)}
            />
          </View>
        ) : null}
        <AppText variant="caption" color={colors.inkSoft} style={styles.note}>
          CareCircle does not replace emergency services. In an emergency, call 911 or your local
          emergency number.
        </AppText>
      </Card>

      <View style={styles.signOut}>
        <Button label="Sign out" variant="danger" loading={loading} onPress={() => void run(signOut)} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.lg },
  detail: { gap: spacing.xs, marginBottom: spacing.md },
  note: { marginTop: spacing.sm },
  support: { marginTop: spacing.sm, marginBottom: spacing.sm, gap: spacing.sm },
  snoozeLabel: { marginTop: spacing.sm, marginBottom: spacing.xs },
  signOut: { marginTop: spacing.md, marginBottom: spacing.lg },
});
