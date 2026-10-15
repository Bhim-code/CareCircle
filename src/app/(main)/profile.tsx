import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { profileSectionsFor } from '@/application/profileSections';
import { env } from '@/config/env';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { Card } from '@/presentation/components/Card';
import { RoleBadge } from '@/presentation/components/RoleBadge';
import { Screen } from '@/presentation/components/Screen';
import { ToggleRow } from '@/presentation/components/ToggleRow';
import { useSubmit } from '@/presentation/hooks/useSubmit';
import { useAuth } from '@/presentation/providers/AuthProvider';
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
              label="Medicine reminders"
              description="A notification on this phone when a medicine is due."
              value={preferences.reminderNotifications}
              onValueChange={(value) => update({ reminderNotifications: value })}
            />
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
            These choices are saved on this phone. Reminders and alerts are not switched on yet.
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
  support: { marginBottom: spacing.sm },
  signOut: { marginTop: spacing.md, marginBottom: spacing.lg },
});
