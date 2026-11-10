import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { groupLinks, otherPerson, validateInviteEmail } from '@/application/careLinks';
import { createCareLinkService } from '@/container';
import type { CareLink } from '@/domain/entities/CareLink';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { Card } from '@/presentation/components/Card';
import { Screen } from '@/presentation/components/Screen';
import { TextField } from '@/presentation/components/TextField';
import { TextLink } from '@/presentation/components/TextLink';
import { InlineLoading } from '@/presentation/components/InlineLoading';
import { useCareLinks } from '@/presentation/hooks/useCareLinks';
import { useAuth } from '@/presentation/providers/AuthProvider';
import { colors, radius, spacing } from '@/presentation/theme/theme';

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/profile');
}

/** Who looks after whom. A patient invites caregivers; a caregiver accepts and sees who they care for. */
export default function CareLinksScreen() {
  const { user, policy } = useAuth();
  const [service] = useState(createCareLinkService);
  const { status, links, retry, invite, accept, remove } = useCareLinks(service, user?.id ?? '', Boolean(user));
  const groups = useMemo(() => groupLinks(links), [links]);

  // The route guard guarantees a signed-in user; this keeps TypeScript honest.
  if (!user || !policy) return null;

  // Patients (who may manage caregivers) invite; everyone else only answers invitations.
  const isPatient = policy.can('caregivers.manage');

  return (
    <Screen>
      <View style={styles.back}>
        <TextLink label="‹ Back" onPress={goBack} />
      </View>
      <AppText variant="title" style={styles.title}>
        {isPatient ? 'My caregivers' : 'People I care for'}
      </AppText>
      <AppText color={colors.inkSoft} style={styles.intro}>
        {isPatient
          ? 'A caregiver you invite can see your records and is told if you miss a medicine. You can remove them at any time.'
          : 'You can see the records and tasks of the people who have accepted you as their caregiver.'}
      </AppText>

      {isPatient ? <InviteForm ownEmail={user.email} onInvite={invite} /> : null}

      {status === 'loading' ? (
        <InlineLoading label="Loading…" />
      ) : null}

      {status === 'error' ? (
        <>
          <Banner tone="error">We could not load this list. Please try again.</Banner>
          <Button label="Try again" variant="secondary" onPress={retry} />
        </>
      ) : null}

      {status === 'ready' ? (
        <>
          <AppText variant="heading" style={styles.sectionTitle}>
            {isPatient ? 'Your caregivers' : 'Your clients'}
          </AppText>
          {groups.active.length === 0 ? (
            <AppText color={colors.inkSoft}>
              {isPatient ? 'No caregiver has accepted yet.' : 'No one has accepted you yet. Accept an invitation below, or ask someone to invite you.'}
            </AppText>
          ) : (
            groups.active.map((link) => (
              <LinkCard
                key={link.id}
                link={link}
                viewerId={user.id}
                subtitle={isPatient ? 'Can see your records' : 'You can see their records'}
                removeLabel={isPatient ? 'Remove caregiver' : 'Stop caring for this person'}
                confirmText={isPatient ? 'Remove this caregiver? They will no longer see your records.' : 'Stop caring for this person? You will no longer see their records.'}
                onRemove={remove}
              />
            ))
          )}

          {groups.pending.length > 0 ? (
            <>
              <AppText variant="heading" style={styles.sectionTitle}>
                Invitations
              </AppText>
              {groups.pending.map((link) => (
                <LinkCard
                  key={link.id}
                  link={link}
                  viewerId={user.id}
                  subtitle={isPatient ? 'Waiting for them to accept' : 'Invited you to be their caregiver'}
                  removeLabel={isPatient ? 'Cancel invitation' : 'Decline'}
                  confirmText={isPatient ? 'Cancel this invitation?' : 'Decline this invitation?'}
                  onRemove={remove}
                  onAccept={isPatient ? undefined : accept}
                />
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function InviteForm({ ownEmail, onInvite }: { ownEmail: string; onInvite: (email: string) => Promise<{ ok: true } | { ok: false; message: string }> }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function handleInvite() {
    const problem = validateInviteEmail(email, ownEmail);
    setSent(null);
    setFailure(null);
    if (problem) {
      setError(problem);
      return;
    }
    setError(undefined);
    setSending(true);
    const result = await onInvite(email);
    setSending(false);
    if (result.ok) {
      setSent(email.trim());
      setEmail('');
    } else {
      setFailure(result.message);
    }
  }

  return (
    <Card title="Invite a caregiver">
      <TextField
        label="Their email address"
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          setError(undefined);
        }}
        error={error}
        placeholder="name@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {failure ? <Banner tone="error">{failure}</Banner> : null}
      {sent ? <Banner tone="success">{`Invitation sent to ${sent}. They can accept it after signing in with that email.`}</Banner> : null}
      <Button label="Send invitation" onPress={handleInvite} loading={sending} />
    </Card>
  );
}

interface LinkCardProps {
  link: CareLink;
  viewerId: string;
  subtitle: string;
  removeLabel: string;
  confirmText: string;
  onRemove: (linkId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Present only for a pending invitation a caregiver may accept. */
  onAccept?: (linkId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
}

function LinkCard({ link, viewerId, subtitle, removeLabel, confirmText, onRemove, onAccept }: LinkCardProps) {
  const person = otherPerson(link, viewerId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'remove' | 'accept' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function run(kind: 'remove' | 'accept') {
    setBusy(kind);
    setFailure(null);
    const result = kind === 'remove' ? await onRemove(link.id) : await onAccept!(link.id);
    // On success the list drops or changes this card, so only a failure needs showing.
    if (!result.ok) {
      setFailure(result.message);
      setBusy(null);
      setConfirming(false);
    }
  }

  return (
    <View style={styles.link}>
      <AppText variant="heading">{person.name}</AppText>
      {person.email !== person.name ? <AppText color={colors.inkSoft}>{person.email}</AppText> : null}
      <AppText variant="caption" color={colors.inkSoft}>
        {subtitle}
      </AppText>
      {failure ? <Banner tone="error">{failure}</Banner> : null}
      {confirming ? (
        <View style={styles.confirm}>
          <AppText variant="label">{confirmText}</AppText>
          <Button label={`Yes, ${removeLabel.toLowerCase()}`} variant="danger" loading={busy === 'remove'} onPress={() => run('remove')} />
          <Button label="No, keep it" variant="secondary" onPress={() => setConfirming(false)} />
        </View>
      ) : (
        <View style={styles.confirm}>
          {onAccept ? <Button label="Accept" loading={busy === 'accept'} onPress={() => run('accept')} /> : null}
          <Button label={removeLabel} variant="secondary" onPress={() => setConfirming(true)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  back: { alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, marginBottom: spacing.xs },
  intro: { marginBottom: spacing.lg },
  sectionTitle: { marginTop: spacing.lg, marginBottom: spacing.sm },
  link: {
    backgroundColor: colors.paper,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  confirm: { gap: spacing.sm, marginTop: spacing.sm },
});
