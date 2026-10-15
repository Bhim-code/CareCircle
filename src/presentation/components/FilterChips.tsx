import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing, touchTarget } from '../theme/theme';
import { AppText } from './AppText';

export interface FilterChipOption<T extends string> {
  value: T;
  label: string;
  /** Shown after the label, e.g. "Lab reports (2)". */
  count?: number;
}

interface FilterChipsProps<T extends string> {
  options: readonly FilterChipOption<T>[];
  selected: T | null;
  onSelect: (value: T) => void;
  /** Read out by screen readers for the whole group. */
  accessibilityLabel: string;
}

/** A row of choices where exactly one is picked. Chips wrap onto more lines when needed. */
export function FilterChips<T extends string>({
  options,
  selected,
  onSelect,
  accessibilityLabel,
}: FilterChipsProps<T>) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={styles.row}>
      {options.map((option) => {
        const active = option.value === selected;
        const text = option.count === undefined ? option.label : `${option.label} (${option.count})`;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={text}
            accessibilityState={{ selected: active, checked: active }}
            onPress={() => onSelect(option.value)}
            style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}
          >
            <AppText variant="label" color={active ? colors.white : colors.harbor}>
              {text}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.harbor,
  },
  chipIdle: { backgroundColor: colors.paper },
  chipActive: { backgroundColor: colors.harbor },
});
