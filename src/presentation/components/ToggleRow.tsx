import React from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { colors, spacing, touchTarget } from '../theme/theme';
import { AppText } from './AppText';

interface ToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}

/** A setting you can switch on or off. The whole row is the touch target. */
export function ToggleRow({ label, description, value, onValueChange }: ToggleRowProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value }}
      onPress={() => onValueChange(!value)}
      style={styles.row}
    >
      <View style={styles.text}>
        <AppText variant="label">{label}</AppText>
        {description ? (
          <AppText variant="caption" color={colors.inkSoft}>
            {description}
          </AppText>
        ) : null}
      </View>
      {/* The row handles the touch and the screen reader; the switch is only the picture. */}
      <View style={styles.picture} accessible={false} importantForAccessibility="no-hide-descendants">
        <Switch
          value={value}
          trackColor={{ false: colors.line, true: colors.harbor }}
          thumbColor={colors.white}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  text: { flex: 1, gap: spacing.xs },
  picture: { pointerEvents: 'none' },
});
