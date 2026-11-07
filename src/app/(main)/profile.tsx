import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { describeProfileError, validateNewName } from '@/application/profile';
import { formatTime } from '@/application/reminders';
import { profileSectionsFor } from '@/application/profileSections';
import { env } from '@/config/env';
import { createProfileService } from '@/container';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { FilterChips } from '@/presentation/components/FilterChips';
import { Card } from '@/presentation/components/Card';
import { RoleBadge } from '@/presentation/components/RoleBadge';
import { Screen } from '@/presentation/components/Screen';
import { TextField } from '@/presentation/components/TextField';
import { TextLink } from '@/presentation/components/TextLink';
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

/** The person's name, with a way to change it. Saved on the server, then shown here at once. */
function NameRow({ name }: { name: string }) {
  const { applyName } = useAuth();
  const [service] = useState(createProfileService);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const problem = validateNewName(value, name);
    if (problem) {
      setError(problem);
      return;
    }
    if (!service) return;
    setSaving(true);
    setFailure(null);
    try {
      applyName(await service.updateName(value));
      setEditing(false);
    } catch (caught) {
      setFailure(describeProfileError(caught));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <View>
        <DetailRow label="Name" value={name || 'Not set'} />
        {service ? (
          <View style={styles.nameLink}>
            <TextLink
              label="Change name"
              onPress={() => {
                setValue(name);
                setError(undefined);
                setFailure(null);
                setEditing(true);
              }}
            />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.nameEdit}>
      <TextField
        label="Your name"
        value={value}
        onChangeText={(text) => {
          setValue(text);
          setError(undefined);
        }}
        error={error}
        autoCapitalize="words"
      />
      {failure ? <Banner tone="error">{failure}</Banner> : null}
      <Button label="Save name" loading={saving} onPress={() => void handleSave()} />
      <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} />
    </View>
  );
}

export default function ProfileScreen() {
  const { user, policy, signOut } = useAuth();
  const { preferences, saveFailed, syncPending, update } = usePreferences();
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
        <NameRow name={user.name} />
        <DetailRow label="Email" value={user.email} />
        <DetailRow label="Account type" value={policy.displayName} />
      </Card>

      <Card title={sections.caregiverContacts ? 'Your caregivers' : 'People you care for'} accent={accent}>
        <AppText color={colors.inkSoft}>
          {sections.caregiverContacts
            ? 'Invite caregivers by email, see who has accepted, and remove anyone you no longer want to see your records.'
            : 'See the people who have accepted you as their caregiver, and answer invitations.'}
        </AppText>
        <View style={styles.support}>
          <Button
            label={sections.caregiverContacts ? 'Manage my caregivers' : 'See my clients and invitations'}
            variant="secondary"
            onPress={() => router.push('/care-links')}
          />
        </View>
      </Card>

      {sections.caregiverContacts ? (
        <Card title="Privacy" accent={accent}>
          <AppText color={colors.inkSoft}>See who has looked at your records, and when.</AppText>
          <View style={styles.support}>
            <Button label="Who has viewed my records" variant="secondary" onPress={() => router.push('/access-log')} />
          </View>
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
            {syncPending
              ? 'Saved on this phone. It will be saved to your account when you are back online.'
              : 'These choices are saved with your account. Alarm sound, vibration and snooze stay on this phone.'}
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
          {syncPending ? ' Your choice will be saved to your account when you are back online.' : ''}
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
  nameLink: { alignItems: 'flex-start', marginBottom: spacing.sm },
  nameEdit: { gap: spacing.sm, marginBottom: spacing.sm },
  support: { marginTop: spacing.sm, marginBottom: spacing.sm, gap: spacing.sm },
  snoozeLabel: { marginTop: spacing.sm, marginBottom: spacing.xs },
  signOut: { marginTop: spacing.md, marginBottom: spacing.lg },
});
