import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import React, { useState } from 'react';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createAlarmScheduler,
  createCareTaskService,
  createHealthRecordService,
  createMedicineService,
  createPreferencesStore,
  createRecordEntryService,
  createReminderService,
} from '@/container';
import { TASKS_VIEW } from '@/application/permissions';
import { usePermission } from '@/presentation/hooks/usePermission';
import { AlarmProvider } from '@/presentation/providers/AlarmProvider';
import { HealthRecordsProvider } from '@/presentation/providers/HealthRecordsProvider';
import { CareTasksProvider } from '@/presentation/providers/CareTasksProvider';
import { MedicinesProvider } from '@/presentation/providers/MedicinesProvider';
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
  const [medicineService] = useState(createMedicineService);
  const [alarmScheduler] = useState(createAlarmScheduler);
  const [entryService] = useState(createRecordEntryService);
  const [careTaskService] = useState(createCareTaskService);
  const [healthRecordService] = useState(createHealthRecordService);
  // Only people the backend lets see care tasks get the Tasks tab.
  const canSeeTasks = usePermission(TASKS_VIEW);
  const insets = useSafeAreaInsets();

  return (
    <PreferencesProvider store={preferencesStore}>
      <MedicinesProvider service={medicineService}>
      <RemindersProvider service={reminderService}>
      <AlarmProvider scheduler={alarmScheduler} reminderService={reminderService}>
      <RecordEntriesProvider service={entryService}>
      <CareTasksProvider service={careTaskService}>
      <HealthRecordsProvider service={healthRecordService}>
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
        <Tabs.Screen
          name="tasks"
          options={canSeeTasks ? tabOptions('Tasks', 'checkbox-outline', 'checkbox', 'Today\'s tasks') : { href: null }}
        />
        <Tabs.Screen name="records" options={tabOptions('Records', 'document-text-outline', 'document-text', 'Health Records')} />
        {/* Care links open from the Profile screen, not from the tab bar. */}
        <Tabs.Screen name="care-links" options={{ href: null }} />
        {/* The alarm screen is opened by an alarm, not from the tab bar. */}
        <Tabs.Screen name="alarm" options={{ href: null, tabBarStyle: { display: 'none' } }} />
        <Tabs.Screen name="profile" options={tabOptions('Profile', 'person-outline', 'person')} />
      </Tabs>
      </HealthRecordsProvider>
      </CareTasksProvider>
      </RecordEntriesProvider>
      </AlarmProvider>
      </RemindersProvider>
      </MedicinesProvider>
    </PreferencesProvider>
  );
}
