import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { validateSignIn, type FieldErrors } from '@/application/validation/authValidators';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { Screen } from '@/presentation/components/Screen';
import { TextField } from '@/presentation/components/TextField';
import { TextLink } from '@/presentation/components/TextLink';
import { useSubmit } from '@/presentation/hooks/useSubmit';
import { useAuth } from '@/presentation/providers/AuthProvider';
import { colors, spacing } from '@/presentation/theme/theme';
import { RoleChoice } from '@/presentation/components/RoleChoice';


export default function LoginScreen() {
  const router = useRouter();
  const { signIn, isDemo, demoAccounts, dev } = useAuth();
  const { loading, error, run, clearError } = useSubmit();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'email' | 'password'>>({});

  function handleSubmit() {
    const errors = validateSignIn({ email, password });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    void run(() => signIn(email, password));
  }

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="heading" color={colors.harbor}>
          CareCircle
        </AppText>
        <AppText variant="title">Sign in</AppText>
        <AppText color={colors.inkSoft}>Welcome back. Your reminders are waiting.</AppText>
      </View>

      {isDemo ? (
        <View style={styles.demo}>
          <Banner tone="info">
            Demo mode: no server is connected. Choose an account to look around.
          </Banner>
          {demoAccounts.map((account) => (
            <View key={account.email} style={styles.demoButton}>
              <Button
                variant="secondary"
                label={`Use the ${account.label.toLowerCase()} account`}
                onPress={() => {
                  setEmail(account.email);
                  setPassword(account.password);
                  setFieldErrors({});
                  clearError();
                }}
              />
            </View>
          ))}
        </View>
      ) : null}

      {error ? <Banner tone="error">{error}</Banner> : null}

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={fieldErrors.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={fieldErrors.password}
        secret
        autoCapitalize="none"
        autoComplete="password"
        textContentType="password"
        onSubmitEditing={handleSubmit}
        returnKeyType="go"
      />

      <Button label="Sign in" onPress={handleSubmit} loading={loading} />

      {dev ? (
        <View style={styles.devButton}>
          <Button label="Dev mode: skip sign-in" variant="secondary" onPress={() => dev.enable('patient')} />
        </View>
      ) : null}

      <View style={styles.links}>
        <TextLink label="Forgot your password?" onPress={() => router.push('/forgot-password')} />
        <TextLink label="Create an account" onPress={() => router.push('/signup')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.lg },
  demo: { marginBottom: spacing.sm },
  demoButton: { marginBottom: spacing.sm },
  devButton: { marginTop: spacing.md },
  links: { marginTop: spacing.lg, alignItems: 'center', gap: spacing.xs },
});
