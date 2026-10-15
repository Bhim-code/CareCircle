import React from 'react';
import { StyleSheet } from 'react-native';
import { AppText } from '@/presentation/components/AppText';
import { Card } from '@/presentation/components/Card';
import { Screen } from '@/presentation/components/Screen';
import { colors, spacing } from '@/presentation/theme/theme';

// Placeholder so the Medications tab has somewhere to go. The real screen is a separate issue.
export default function MedicationsScreen() {
  return (
    <Screen>
      <AppText variant="title" style={styles.title}>
        Medications
      </AppText>
      <Card title="Today's medicines">
        <AppText color={colors.inkSoft}>
          No medicines have been added yet. Your medicine reminders will appear here.
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({ title: { marginTop: spacing.sm, marginBottom: spacing.lg } });
