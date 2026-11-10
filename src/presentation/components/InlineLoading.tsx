import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '../theme/theme';
import { AppText } from './AppText';
import { LoadingDots } from './LoadingDots';

/** A line of text with small pulsing dots in front of it, for a list or a section that is loading. */
export function InlineLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
    >
      <LoadingDots size={8} announce={false} />
      <AppText color={colors.inkSoft}>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
