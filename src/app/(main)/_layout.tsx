import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import React, { useState } from 'react';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createAlarmScheduler, createPreferencesStore, createRecordEntryService, createReminderService } from '@/container';
import { AlarmProvider } from '@/presentation/providers/AlarmProvider';
import { PreferencesProvider } from '@/presentation/providers/PreferencesProvider';
import { RecordEntriesProvider } from '@/presentation/providers/RecordEntriesProvider';
import { RemindersProvider } from '@/presentation/providers/RemindersProvider';
import { colors } from '@/presentation/theme/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** The title and icon for one tab. The icon is filled in when its tab is selected. */
function tabOptions(title: string, icon: IconName, selectedIcon: IconName, spokenName = title) {
  return {
    title,
    tabBarAccessibilityLabel: spokenName,
    tabBarIcon: ({ color, focused }: { color: ColorValue; focused: boolean }) => (
      <Ionicons name={focused ? selectedIcon : icon} size={26} color={color} />
    ),
  };
}

export default function MainLayout() {
  // Settings belong to the signed-in person, so they are only loaded in this part of the app.
  const [preferencesStore] = useState(createPreferencesStore);
  const [reminderService] = useState(createReminderService);
  const [alarmScheduler] = useState(createAlarmScheduler);
  const [entryService] = useState(createRecordEntryService);
  const insets = useSafeAreaInsets();

  return (
    <PreferencesProvider store={preferencesStore}>
      <RemindersProvider service={reminderService}>
      <AlarmProvider scheduler={alarmScheduler} reminderService={reminderService}>
      <RecordEntriesProvider service={entryService}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.harbor,
          tabBarInactiveTintColor: colors.inkSoft,
          // The selected tab gets a tinted background, a filled icon and bold text.
          tabBarActiveBackgroundColor: colors.tint,
          tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
          // The height includes the space under the bar on phones with a home indicator.
          tabBarStyle: {
            height: 72 + insets.bottom,
            backgroundColor: colors.paper,
            borderTopColor: colors.line,
          },
          sceneStyle: { backgroundColor: colors.mist },
        }}
      >
        <Tabs.Screen name="index" options={tabOptions('Home', 'home-outline', 'home')} />
        <Tabs.Screen name="medications" options={tabOptions('Medications', 'medkit-outline', 'medkit')} />
        <Tabs.Screen name="records" options={tabOptions('Records', 'document-text-outline', 'document-text', 'Health Records')} />
        {/* The alarm screen is opened by an alarm, not from the tab bar. */}
        <Tabs.Screen name="alarm" options={{ href: null, tabBarStyle: { display: 'none' } }} />
        <Tabs.Screen name="profile" options={tabOptions('Profile', 'person-outline', 'person')} />
      </Tabs>
      </RecordEntriesProvider>
      </AlarmProvider>
      </RemindersProvider>
    </PreferencesProvider>
  );
}
