import { Stack } from 'expo-router';
import React from 'react';
import { colors } from '@/presentation/theme/theme';

// The list and the detail screen sit inside the Medications tab, so the tab bar stays visible.
export default function MedicationsLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.mist } }} />;
}
