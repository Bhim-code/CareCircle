import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { createPreferencesStore } from '@/container';
import { PreferencesProvider } from '@/presentation/providers/PreferencesProvider';
import { colors } from '@/presentation/theme/theme';

export default function MainLayout() {
  // Settings belong to the signed-in person, so they are only loaded in this part of the app.
  const [preferencesStore] = useState(createPreferencesStore);

  return (
    <PreferencesProvider store={preferencesStore}>
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.mist } }}
      />
    </PreferencesProvider>
  );
}
