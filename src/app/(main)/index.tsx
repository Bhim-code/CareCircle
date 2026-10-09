import React from 'react';
import { StyleSheet, View } from 'react-native';
import { firstName, greetingFor } from '@/application/greeting';
import { AppText } from '@/presentation/components/AppText';
import { Button } from '@/presentation/components/Button';
import { Can } from '@/presentation/components/Can';
import { Card } from '@/presentation/components/Card';
import { RoleBadge } from '@/presentation/components/RoleBadge';
import { Screen } from '@/presentation/components/Screen';
import { useSubmit } from '@/presentation/hooks/useSubmit';
import { useAuth } from '@/presentation/providers/AuthProvider';
import { colors, roleAccent, spacing } from '@/presentation/theme/theme';

export default function DashboardScreen() {
  const { user, policy, signOut } = useAuth();
  const { loading, run } = useSubmit();

  // The route guard guarantees both exist; this keeps TypeScript honest.
  if (!user || !policy) return null;

  const accent = roleAccent[user.role].foreground;

  return (
    <Screen>
      <View style={styles.header}>
        <RoleBadge role={user.role} label={policy.displayName} />
        <AppText variant="title">
          {greetingFor(new Date())}, {firstName(user.name) || 'there'}
        </AppText>
        <AppText color={colors.inkSoft}>{user.email}</AppText>
      </View>

      <Can permission="reminders.manage">
        <Card title="Today's reminders" accent={accent}>
          <AppText color={colors.inkSoft}>
            Nothing is scheduled yet. Medication reminders you add will appear here.
          </AppText>
        </Card>
      </Can>

      <Can permission="caregivers.manage">
        <Card title="Your caregivers" accent={accent}>
          <AppText color={colors.inkSoft}>
            No one has been added. Caregivers you invite will be alerted if you miss a reminder.
          </AppText>
        </Card>
      </Can>

      <Can permission="alerts.receive">
        <Card title="Alerts" accent={accent}>
          <AppText color={colors.inkSoft}>
            No alerts right now. You will be notified here if someone misses a reminder.
          </AppText>
        </Card>
      </Can>

      <Can permission="patients.monitor">
        <Card title="People you care for" accent={accent}>
          <AppText color={colors.inkSoft}>
            No one is linked to you yet. Ask them to add you as their caregiver.
          </AppText>
        </Card>
      </Can>

      <View style={styles.signOut}>
        <Button label="Sign out" variant="secondary" loading={loading} onPress={() => void run(signOut)} />
      </View>

      <AppText variant="caption" color={colors.inkSoft} style={styles.notice}>
        CareCircle does not replace emergency services. In an emergency, call 911 or your local
        emergency number.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.lg },
  signOut: { marginTop: spacing.md },
  notice: { marginTop: spacing.lg, textAlign: 'center' },
});
