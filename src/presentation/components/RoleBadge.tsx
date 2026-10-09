import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Role } from '../../domain/entities/Role';
import { radius, roleAccent, spacing } from '../theme/theme';
import { AppText } from './AppText';

interface RoleBadgeProps {
  role: Role;
  label: string;
}

export function RoleBadge({ role, label }: RoleBadgeProps) {
  const accent = roleAccent[role];
  return (
    <View style={[styles.badge, { backgroundColor: accent.background }]}>
      <AppText variant="label" color={accent.foreground}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
