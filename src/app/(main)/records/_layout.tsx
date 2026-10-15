import { Stack } from 'expo-router';
import React from 'react';
import { colors } from '@/presentation/theme/theme';

// The list and the add/edit form sit inside the Records tab, so the tab bar stays visible.
export default function RecordsLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.mist } }} />;
}
