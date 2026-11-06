import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { firstName } from '@/application/greeting';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { Card } from '@/presentation/components/Card';
import { Screen } from '@/presentation/components/Screen';
import { useApprovalWatch } from '@/presentation/hooks/useApprovalWatch';
import { useAuth } from '@/presentation/providers/AuthProvider';
import { colors, spacing } from '@/presentation/theme/theme';

/** Shown to someone who has signed up but whom no supervisor has approved yet. */
export default function WaitingForApprovalScreen() {
  const { pendingUser, checkApproval, signOut } = useAuth();
  const { checking, last, checkNow } = useApprovalWatch(checkApproval);

  return (
    <Screen>
      <View style={styles.header}>
        <Ionicons name="hourglass-outline" size={48} color={colors.harbor} accessibilityElementsHidden />
        <AppText variant="title" accessibilityRole="header">
          Waiting for approval
        </AppText>
        <AppText color={colors.inkSoft}>
          {pendingUser ? `Thank you for signing up, ${firstName(pendingUser.name)}. ` : ''}
          A supervisor needs to approve your account before you can use CareCircle.
        </AppText>
      </View>

      <Card title="What happens next">
        <AppText>
          When a supervisor approves you, you will be asked to sign in again. After that, everything is ready.
        </AppText>
        <AppText color={colors.inkSoft}>We check for you from time to time. You can also check yourself.</AppText>
      </Card>

      {last?.kind === 'pending' ? <Banner tone="info">Still waiting. We will keep checking.</Banner> : null}
      {last?.kind === 'offline' ? <Banner tone="error">{last.message}</Banner> : null}

      <Button label="Check again" onPress={() => void checkNow()} loading={checking} />
      <View style={styles.signOut}>
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm, marginTop: spacing.xl, marginBottom: spacing.lg },
  signOut: { marginTop: spacing.md },
});
