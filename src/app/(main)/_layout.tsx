import { Stack } from 'expo-router';
import React from 'react';
import { colors } from '@/presentation/theme/theme';

export default function MainLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.mist } }}
    />
  );
}
