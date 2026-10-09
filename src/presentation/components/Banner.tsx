import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme/theme';
import { AppText } from './AppText';

type Tone = 'error' | 'info' | 'success';

const tones: Record<Tone, { background: string; text: string; bar: string }> = {
  error: { background: colors.dangerTint, text: colors.danger, bar: colors.danger },
  info: { background: colors.tint, text: colors.ink, bar: colors.harbor },
  success: { background: colors.successTint, text: colors.success, bar: colors.success },
};

interface BannerProps {
  tone: Tone;
  children: string;
}

/** A short message with a coloured edge. Errors are announced to screen readers. */
export function Banner({ tone, children }: BannerProps) {
  const palette = tones[tone];
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      style={[styles.banner, { backgroundColor: palette.background, borderLeftColor: palette.bar }]}
    >
      <AppText variant="label" color={palette.text}>
        {children}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderLeftWidth: 5,
    borderRadius: radius.field,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
});
