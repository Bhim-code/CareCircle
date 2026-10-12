import React from 'react';
import { StyleSheet } from 'react-native';
import { AppText } from '@/presentation/components/AppText';
import { Card } from '@/presentation/components/Card';
import { Screen } from '@/presentation/components/Screen';
import { colors, spacing } from '@/presentation/theme/theme';

// Placeholder so the Health Records tab has somewhere to go. The real screen is a separate issue.
export default function HealthRecordsScreen() {
  return (
    <Screen>
      <AppText variant="title" style={styles.title}>
        My health records
      </AppText>
      <Card title="Nothing here yet">
        <AppText color={colors.inkSoft}>
          Your prescriptions, lab reports and other documents will appear here.
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({ title: { marginTop: spacing.sm, marginBottom: spacing.lg } });
