import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Role } from '../../domain/entities/Role';
import { colors, radius, roleAccent, spacing } from '../theme/theme';
import { AppText } from './AppText';

interface Option {
  role: Role;
  title: string;
  description: string;
}

const OPTIONS: Option[] = [
  { role: 'patient', title: 'I take medication', description: 'Get reminders and let family know if you miss one.' },
  { role: 'caregiver', title: 'I look after someone', description: 'Get an alert when a reminder goes unanswered.' },
];

interface RoleChoiceProps {
  value: Role | '';
  onChange: (role: Role) => void;
  error?: string;
}

/** Two large radio cards. The choice is the first thing asked at sign-up. */
export function RoleChoice({ value, onChange, error }: RoleChoiceProps) {
  return (
    <View style={styles.wrapper} accessibilityRole="radiogroup">
      <AppText variant="label" style={styles.legend}>
        How will you use CareCircle?
      </AppText>
      {OPTIONS.map((option) => {
        const selected = value === option.role;
        const accent = roleAccent[option.role];
        return (
          <Pressable
            key={option.role}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${option.title}. ${option.description}`}
            onPress={() => onChange(option.role)}
            style={[
              styles.option,
              {
                borderColor: selected ? accent.foreground : colors.line,
                borderWidth: selected ? 2 : 1,
                backgroundColor: selected ? accent.background : colors.paper,
              },
            ]}
          >
            <AppText variant="label" color={selected ? accent.foreground : colors.ink}>
              {option.title}
            </AppText>
            <AppText variant="caption" color={colors.inkSoft}>
              {option.description}
            </AppText>
          </Pressable>
        );
      })}
      {error ? (
        <AppText variant="caption" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: spacing.md },
  legend: { marginBottom: spacing.sm },
  option: {
    borderRadius: radius.field,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
    minHeight: 72,
    justifyContent: 'center',
  },
});
