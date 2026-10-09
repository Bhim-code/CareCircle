import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme/theme';
import { AppText } from './AppText';

interface AccessRestrictedProps {
  /** The signed-in person's role, in words, e.g. "Caregiver". */
  yourRole: string;
}

export function AccessRestricted({ yourRole }: AccessRestrictedProps) {
  return (
    <View style={styles.box} accessibilityRole="alert">
      <AppText variant="heading">Access restricted</AppText>
      <AppText color={colors.inkSoft}>
        This part of CareCircle is not available to your account type.
      </AppText>
      <AppText variant="caption" color={colors.inkSoft}>
        Your account type: {yourRole}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.paper,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
});
