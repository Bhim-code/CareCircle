import { Stack } from 'expo-router';
import React from 'react';
import { colors } from '@/presentation/theme/theme';

// The list and the "extra work" form sit inside the Tasks tab, so the tab bar stays visible.
export default function TasksLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.mist } }} />;
}
