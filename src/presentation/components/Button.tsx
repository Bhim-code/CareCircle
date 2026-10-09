import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing, touchTarget, typography } from '../theme/theme';
import { AppText } from './AppText';

type Variant = 'primary' | 'secondary' | 'danger';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
}

const palette: Record<
  Variant,
  { background: string; pressed: string; text: string; border: string }
> = {
  primary: {
    background: colors.harbor,
    pressed: colors.harborPressed,
    text: colors.white,
    border: colors.harbor,
  },
  secondary: {
    background: colors.paper,
    pressed: colors.tint,
    text: colors.harbor,
    border: colors.harbor,
  },
  danger: {
    background: colors.paper,
    pressed: colors.dangerTint,
    text: colors.danger,
    border: colors.danger,
  },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
}: ButtonProps) {
  const colorsFor = palette[variant];
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: pressed ? colorsFor.pressed : colorsFor.background,
          borderColor: colorsFor.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={colorsFor.text} />
        ) : (
          <AppText style={typography.label} color={colorsFor.text}>
            {label}
          </AppText>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget,
    borderRadius: radius.button,
    borderWidth: 2,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  content: { alignItems: 'center', justifyContent: 'center' },
});
