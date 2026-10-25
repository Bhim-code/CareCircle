import React from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '../theme/theme';
import { usePreferences } from '../providers/PreferencesProvider';
import { useAlarms } from '../providers/AlarmProvider';
import { Banner } from './Banner';
import { Button } from './Button';

/**
 * Shown to a patient when alarms are on but the phone has not allowed them.
 * Without this, a missing permission would fail silently and no alarm would ring.
 */
export function AlarmPermissionNotice() {
  const { preferences } = usePreferences();
  const { permission, askForPermission } = useAlarms();

  if (!preferences.reminderNotifications) return null;
  if (permission !== 'denied' && permission !== 'undetermined') return null;

  return (
    <View style={styles.box}>
      <Banner tone="error">
        Medicine alarms are off, because this phone has not allowed notifications for CareCircle.
        You will not be reminded until you allow them.
      </Banner>
      <Button
        label={permission === 'denied' ? 'Open phone settings' : 'Allow medicine alarms'}
        onPress={() => void askForPermission()}
      />
    </View>
  );
}

const styles = StyleSheet.create({ box: { gap: spacing.sm, marginBottom: spacing.md } });
