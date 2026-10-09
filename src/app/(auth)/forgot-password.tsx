import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { validateEmail } from '@/application/validation/authValidators';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { Screen } from '@/presentation/components/Screen';
import { TextField } from '@/presentation/components/TextField';
import { TextLink } from '@/presentation/components/TextLink';
import { useSubmit } from '@/presentation/hooks/useSubmit';
import { useAuth } from '@/presentation/providers/AuthProvider';
import { colors, spacing } from '@/presentation/theme/theme';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { requestPasswordReset } = useAuth();
  const { loading, error, run } = useSubmit();

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    const problem = validateEmail(email);
    setEmailError(problem);
    if (problem) return;
    const ok = await run(() => requestPasswordReset(email));
    if (ok) setSent(true);
  }

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="heading" color={colors.harbor}>
          CareCircle
        </AppText>
        <AppText variant="title">Reset your password</AppText>
        <AppText color={colors.inkSoft}>
          Enter your email and we will send you a link to choose a new password.
        </AppText>
      </View>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {sent ? (
        // Worded so it does not reveal whether an account exists for this address.
        <Banner tone="success">
          If an account uses that email, a reset link is on its way.
        </Banner>
      ) : null}

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={emailError}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        onSubmitEditing={handleSubmit}
        returnKeyType="send"
      />

      <Button label={sent ? 'Send it again' : 'Send reset link'} onPress={handleSubmit} loading={loading} />

      <View style={styles.links}>
        <TextLink label="Back to sign in" onPress={() => router.replace('/login')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.lg },
  links: { marginTop: spacing.lg, alignItems: 'center' },
});
