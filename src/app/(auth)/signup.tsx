import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { validateSignUp, type FieldErrors, type SignUpValues } from '@/application/validation/authValidators';
import { isRole, type Role } from '@/domain/entities/Role';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { RoleChoice } from '@/presentation/components/RoleChoice';
import { Screen } from '@/presentation/components/Screen';
import { TextField } from '@/presentation/components/TextField';
import { TextLink } from '@/presentation/components/TextLink';
import { useSubmit } from '@/presentation/hooks/useSubmit';
import { useAuth } from '@/presentation/providers/AuthProvider';
import { colors, spacing } from '@/presentation/theme/theme';

export default function SignUpScreen() {
  const router = useRouter();
  const { signUp } = useAuth();
  const { loading, error, run } = useSubmit();

  const [role, setRole] = useState<Role | ''>('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<keyof SignUpValues>>({});
  const [confirmEmailFor, setConfirmEmailFor] = useState<string | null>(null);

  function handleSubmit() {
    const errors = validateSignUp({ role, name, email, password, confirmation });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || !isRole(role)) return;

    void run(async () => {
      const result = await signUp({ role, name, email, password });
      if (result.needsEmailConfirmation) setConfirmEmailFor(email.trim());
      // Otherwise the person is already signed in and the app moves on by itself.
    });
  }

  if (confirmEmailFor) {
    return (
      <Screen>
        <View style={styles.header}>
          <AppText variant="title">Check your email</AppText>
          <AppText color={colors.inkSoft}>
            We sent a link to {confirmEmailFor}. Open it to confirm your account, then sign in.
          </AppText>
        </View>
        <Button label="Go to sign in" onPress={() => router.replace('/login')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="heading" color={colors.harbor}>
          CareCircle
        </AppText>
        <AppText variant="title">Create your account</AppText>
      </View>

      {error ? <Banner tone="error">{error}</Banner> : null}

      {/* <RoleChoice value={role} onChange={setRole} error={fieldErrors.role} /> */}

      <TextField
        label="Your name"
        value={name}
        onChangeText={setName}
        error={fieldErrors.name}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
      />
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
        label="Password (8 or more characters)"
        value={password}
        onChangeText={setPassword}
        error={fieldErrors.password}
        secret
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <TextField
        label="Repeat your password"
        value={confirmation}
        onChangeText={setConfirmation}
        error={fieldErrors.confirmation}
        secret
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        onSubmitEditing={handleSubmit}
        returnKeyType="go"
      />

      <Button label="Create account" onPress={handleSubmit} loading={loading} />

      <View style={styles.links}>
        <TextLink label="I already have an account" onPress={() => router.replace('/login')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.lg },
  links: { marginTop: spacing.lg, alignItems: 'center' },
});
