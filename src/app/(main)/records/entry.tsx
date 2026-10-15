import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import {
  FIELDS_FOR_KIND,
  KIND_LABEL,
  MOODS,
  INCIDENT_SEVERITIES,
  MOOD_LABEL,
  SEVERITY_LABEL,
  blankDraft,
  canEditEntry,
  draftFromEntry,
  permissionFor,
  validateDraft,
  type DraftErrors,
  type DraftField,
  type EntryDraft,
} from '@/application/recordEntries';
import { ENTRY_KINDS, type EntryKind, type RecordEntryInput } from '@/domain/entities/RecordEntry';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { Card } from '@/presentation/components/Card';
import { FilterChips } from '@/presentation/components/FilterChips';
import { PhotoCapture } from '@/presentation/components/PhotoCapture';
import { Screen } from '@/presentation/components/Screen';
import { TextField } from '@/presentation/components/TextField';
import { TextLink } from '@/presentation/components/TextLink';
import { useAuth } from '@/presentation/providers/AuthProvider';
import { useEntries } from '@/presentation/providers/RecordEntriesProvider';
import { colors, radius, spacing } from '@/presentation/theme/theme';

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/records');
}

function asKind(value: string | undefined): EntryKind | null {
  return ENTRY_KINDS.find((kind) => kind === value) ?? null;
}

/** One screen for adding a record and for editing one. `id` in the address means editing. */
export default function EntryFormScreen() {
  const { kind: kindParam, id } = useLocalSearchParams<{ kind?: string; id?: string }>();
  const { user, policy } = useAuth();
  const { status, entries, add, update } = useEntries();

  if (!user || !policy) return null;

  const existing = id ? entries.find((entry) => entry.id === id) : undefined;
  const kind = existing ? existing.kind : asKind(kindParam);

  // Wait for the list before deciding that an entry being edited does not exist.
  if (id && status === 'loading') {
    return (
      <Screen>
        <BackLink />
        <AppText color={colors.inkSoft}>Loading…</AppText>
      </Screen>
    );
  }

  // Wrong address, or a role that may not write this kind, or someone else's entry.
  const allowed = kind && policy.can(permissionFor(kind)) && (!id || (existing && canEditEntry(policy, user, existing)));
  if (!kind || !allowed) {
    return (
      <Screen>
        <BackLink />
        <Card title="Not available">
          <AppText color={colors.inkSoft}>
            {id && !existing
              ? 'This record is no longer available.'
              : 'Your account cannot add or change this kind of record.'}
          </AppText>
        </Card>
      </Screen>
    );
  }

  return (
    <EntryForm
      key={id ?? kind}
      kind={kind}
      editingId={existing?.id ?? null}
      initial={existing ? draftFromEntry(existing) : blankDraft(user, new Date())}
      onSave={async (input) =>
        existing
          ? update({ id: user.id, name: user.name, role: user.role }, existing.id, input)
          : add({ id: user.id, name: user.name, role: user.role }, input)
      }
    />
  );
}

function BackLink() {
  return (
    <View style={styles.back}>
      <TextLink label="‹ Back" onPress={goBack} />
    </View>
  );
}

interface FormProps {
  kind: EntryKind;
  editingId: string | null;
  initial: EntryDraft;
  onSave: (input: RecordEntryInput) => Promise<unknown>;
}

function EntryForm({ kind, editingId, initial, onSave }: FormProps) {
  const [draft, setDraft] = useState<EntryDraft>(initial);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const shown = FIELDS_FOR_KIND[kind];
  const show = (field: DraftField) => shown.includes(field);

  function change<K extends DraftField>(field: K, value: EntryDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSave() {
    const result = validateDraft(kind, draft, new Date());
    if (!result.ok) {
      setErrors(result.errors);
      setFailed(false);
      return;
    }
    setSaving(true);
    setFailed(false);
    const saved = await onSave(result.input);
    setSaving(false);
    if (saved) goBack();
    else setFailed(true);
  }

  if (capturing) {
    return (
      <PhotoCapture
        onCancel={() => setCapturing(false)}
        onDone={(uri) => {
          change('photoUri', uri);
          setCapturing(false);
        }}
      />
    );
  }

  const incident = kind === 'incident';
  const notesLabel =
    kind === 'incident'
      ? 'What happened?'
      : kind === 'behavioural'
        ? 'What did you notice? (optional)'
        : kind === 'medical'
          ? 'Details (optional)'
          : 'Notes (optional)';

  return (
    <Screen>
      <BackLink />
      <AppText variant="title" style={styles.title}>
        {editingId ? 'Edit' : 'New'} {KIND_LABEL[kind].toLowerCase()}
      </AppText>
      {editingId ? (
        <Banner tone="info">Saving will mark this record as edited. The original time it was recorded stays.</Banner>
      ) : null}

      {show('clientName') ? (
        <TextField
          label="Client name"
          value={draft.clientName}
          onChangeText={(text) => change('clientName', text)}
          error={errors.clientName}
          placeholder="Name of the person being cared for"
          autoCapitalize="words"
        />
      ) : null}

      {show('title') ? (
        <TextField
          label="What is this about?"
          value={draft.title}
          onChangeText={(text) => change('title', text)}
          error={errors.title}
          placeholder="For example: headache, doctor visit"
        />
      ) : null}

      {show('medicineName') ? (
        <TextField
          label="Medicine name"
          value={draft.medicineName}
          onChangeText={(text) => change('medicineName', text)}
          error={errors.medicineName}
          placeholder="For example: Metformin"
        />
      ) : null}

      {show('photoUri') ? (
        <View style={styles.block}>
          <AppText variant="label" style={styles.blockLabel}>
            Photo of the medicine (optional)
          </AppText>
          {draft.photoUri ? (
            <Image
              accessibilityLabel="Photo of the medicine"
              source={{ uri: draft.photoUri }}
              style={styles.photo}
              resizeMode="cover"
            />
          ) : null}
          <Button
            label={draft.photoUri ? 'Retake photo' : 'Take a photo'}
            variant="secondary"
            onPress={() => setCapturing(true)}
          />
          {draft.photoUri ? (
            <View style={styles.removeRow}>
              <TextLink label="Remove photo" onPress={() => change('photoUri', null)} />
            </View>
          ) : null}
        </View>
      ) : null}

      {show('mood') ? (
        <View style={styles.block}>
          <AppText variant="label" style={styles.blockLabel}>
            How did they seem?
          </AppText>
          <FilterChips
            accessibilityLabel="How they seemed"
            selected={draft.mood}
            onSelect={(value) => change('mood', value)}
            options={MOODS.map((value) => ({ value, label: MOOD_LABEL[value] }))}
          />
          {errors.mood ? <FieldError message={errors.mood} /> : null}
        </View>
      ) : null}

      {show('location') ? (
        <TextField
          label="Where did it happen?"
          value={draft.location}
          onChangeText={(text) => change('location', text)}
          error={errors.location}
          placeholder="For example: bathroom, kitchen"
        />
      ) : null}

      {show('severity') ? (
        <View style={styles.block}>
          <AppText variant="label" style={styles.blockLabel}>
            How serious was it?
          </AppText>
          <FilterChips
            accessibilityLabel="How serious it was"
            selected={draft.severity}
            onSelect={(value) => change('severity', value)}
            options={INCIDENT_SEVERITIES.map((value) => ({ value, label: SEVERITY_LABEL[value] }))}
          />
          {errors.severity ? <FieldError message={errors.severity} /> : null}
        </View>
      ) : null}

      {show('notes') ? (
        <TextField
          label={notesLabel}
          value={draft.notes}
          onChangeText={(text) => change('notes', text)}
          error={errors.notes}
          multiline
          textAlignVertical="top"
        />
      ) : null}

      {show('actionTaken') ? (
        <TextField
          label="What was done afterwards? (optional)"
          value={draft.actionTaken}
          onChangeText={(text) => change('actionTaken', text)}
          error={errors.actionTaken}
          multiline
          textAlignVertical="top"
        />
      ) : null}

      {show('witnessName') ? (
        <TextField
          label="Witness (optional)"
          value={draft.witnessName}
          onChangeText={(text) => change('witnessName', text)}
          error={errors.witnessName}
          placeholder="Name of anyone who saw it happen"
          autoCapitalize="words"
        />
      ) : null}

      {show('date') ? (
        <TextField
          label={incident ? 'Date of the incident' : 'Date'}
          value={draft.date}
          onChangeText={(text) => change('date', text)}
          error={errors.date}
          placeholder="2026-10-15"
          keyboardType="numbers-and-punctuation"
        />
      ) : null}

      {show('time') ? (
        <TextField
          label={incident ? 'Time of the incident' : 'Time'}
          value={draft.time}
          onChangeText={(text) => change('time', text)}
          error={errors.time}
          placeholder="14:30 or 2:30 PM"
          keyboardType="numbers-and-punctuation"
        />
      ) : null}

      <AppText variant="caption" color={colors.inkSoft} style={styles.note}>
        The time you save this, and your name, are added automatically.
      </AppText>

      {Object.keys(errors).some((key) => errors[key as DraftField]) ? (
        <Banner tone="error">Please fix the highlighted boxes.</Banner>
      ) : null}
      {failed ? <Banner tone="error">We could not save this record. Please try again.</Banner> : null}

      <Button label={editingId ? 'Save changes' : 'Save record'} onPress={handleSave} loading={saving} />
      <View style={styles.gap} />
      <Button label="Cancel" variant="secondary" onPress={goBack} disabled={saving} />
    </Screen>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <AppText variant="caption" color={colors.danger} accessibilityLiveRegion="polite">
      {message}
    </AppText>
  );
}

const styles = StyleSheet.create({
  back: { alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, marginBottom: spacing.md },
  block: { marginBottom: spacing.md },
  blockLabel: { marginBottom: spacing.xs },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.field,
    backgroundColor: colors.mist,
    marginBottom: spacing.sm,
  },
  removeRow: { alignItems: 'flex-start' },
  note: { marginBottom: spacing.md },
  gap: { height: spacing.sm },
});
