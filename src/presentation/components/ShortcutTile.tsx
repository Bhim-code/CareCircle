import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { spacing } from '../theme/theme';
import { AppText } from './AppText';

interface ShortcutTileProps {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** Background of the circle. */
  tint: string;
  /** Colour of the icon. */
  color: string;
  onPress: () => void;
}

/** A round coloured icon with a label underneath. Used for quick links on the Home screen. */
export function ShortcutTile({ label, icon, tint, color, onPress }: ShortcutTileProps) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.tile}>
      <View style={[styles.circle, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={34} color={color} />
      </View>
      <AppText variant="label" style={styles.label}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, alignItems: 'center', gap: spacing.sm },
  circle: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  label: { textAlign: 'center' },
});
