import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme/theme';
import { AppText } from './AppText';

interface CardProps {
  title: string;
  /** Colour of the left edge. Marks which role or state the card belongs to. */
  accent?: string;
  children: ReactNode;
}

export function Card({ title, accent = colors.harbor, children }: CardProps) {
  return (
    <View style={[styles.card, { borderLeftColor: accent }]}>
      <AppText variant="heading" style={styles.title}>
        {title}
      </AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paper,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 6,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  title: { marginBottom: spacing.sm },
});
