import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { createContainer } from '@/container';
import { DevToolbar } from '@/presentation/components/DevToolbar';
import { LoadingScreen } from '@/presentation/components/LoadingScreen';
import { AuthProvider, useAuth } from '@/presentation/providers/AuthProvider';
import { colors } from '@/presentation/theme/theme';
import { RoleChoice } from '@/presentation/components/RoleChoice';
import { isRole, type Role } from '@/domain/entities/Role';

  const [role, setRole] = useState<Role | ''>('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<keyof SignUpValues>>({});


export default function RootLayout() {
  // Build the concrete services once, here, and hand them down as interfaces.
  const [container] = useState(createContainer);

  return (
    <AuthProvider
      service={container.authService}
      isDemo={container.isDemo}
      demoAccounts={container.demoAccounts}
      devControls={container.devControls}
    >
      <StatusBar style="dark" />
      <View style={styles.fill}>
        <RootNavigator />
        {/* Renders nothing in release builds. */}
        <DevToolbar />
      </View>
    </AuthProvider>
  );
}

/** The single place that decides who may see which part of the app. */
  <RoleChoice value={role} onChange={setRole} error={fieldErrors.role} />

function RootNavigator() {
  const { status } = useAuth();

  if (status === 'loading') return <LoadingScreen />;

  const signedIn = status === 'signedIn';

  return (


    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.mist } }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(main)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
