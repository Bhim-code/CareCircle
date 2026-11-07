import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { usePermission } from '@/presentation/hooks/usePermission';
import { DOCUMENTS_UPLOAD } from '@/application/permissions';
import { formatSize, kindOfFile, validateUpload, type UploadDraft, type UploadErrors } from '@/application/documents';
import { categoryLabel, filterLabel } from '@/application/healthRecords';
import { createFilePicker } from '@/container';
import { HEALTH_RECORD_CATEGORIES, type PickedFile } from '@/domain/entities/HealthRecord';
import type { Person } from '@/domain/entities/Person';
import { AccessRestricted } from '@/presentation/components/AccessRestricted';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { FilterChips } from '@/presentation/components/FilterChips';
import { Screen } from '@/presentation/components/Screen';
import { TextField } from '@/presentation/components/TextField';
import { TextLink } from '@/presentation/components/TextLink';
import { useAuth } from '@/presentation/providers/AuthProvider';
import { useDocumentList } from '@/presentation/providers/HealthRecordsProvider';
import { colors, radius, spacing } from '@/presentation/theme/theme';

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/records');
}

export default function AddDocumentScreen() {
  const { user } = useAuth();
  const allowed = usePermission(DOCUMENTS_UPLOAD);
  return (
    <Screen>
      <View style={styles.back}>
        <TextLink label="‹ Back" onPress={goBack} />
      </View>
      <AppText variant="title" style={styles.title}>
        Add a document
      </AppText>
      {allowed ? <AddDocumentForm /> : <AccessRestricted yourRole={user?.role ?? 'None'} />}
    </Screen>
  );
}

function AddDocumentForm() {
  const { upload, clients } = useDocumentList();
  const [picker] = useState(createFilePicker);
  const [draft, setDraft] = useState<UploadDraft>({ title: '', category: '', recordedOn: '', file: null });
  const [errors, setErrors] = useState<UploadErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [people, setPeople] = useState<readonly Person[]>([]);

  // A caregiver with several clients must say whose document this is.
  useEffect(() => {
    let active = true;
    clients().then((found) => {
      if (active) setPeople(found);
    });
    return () => {
      active = false;
    };
  }, [clients]);
  const needsClient = people.length > 1;

  function change<K extends keyof UploadDraft>(field: K, value: UploadDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function pick(choose: () => Promise<PickedFile | null>) {
    setFailure(null);
    try {
      const file = await choose();
      if (file) {
        change('file', file);
        // Offer the file's name as the title when nothing is written yet.
        setDraft((current) =>
          current.title.trim() === '' ? { ...current, file, title: file.name.replace(/\.[^.]+$/, '') } : { ...current, file },
        );
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'We could not open that. Please try again.');
    }
  }

  async function handleSave() {
    const check = validateUpload(draft, new Date(), needsClient);
    if (!check.ok) {
      setErrors(check.errors);
      setFailure(null);
      return;
    }
    setSaving(true);
    setFailure(null);
    const result = await upload(check.input);
    setSaving(false);
    if (result.ok) goBack();
    else setFailure(result.message);
  }

  const file = draft.file;
  const isImage = file ? kindOfFile(file) === 'image' : false;

  return (
    <>
      <AppText color={colors.inkSoft} style={styles.intro}>
        Add a prescription, lab report or other paper as a photo or a PDF (up to 10 MB).
      </AppText>

      <View style={styles.pickers}>
        <Button label="Take a photo" variant="secondary" onPress={() => pick(() => picker.takePhoto())} />
        <Button label="Choose a photo" variant="secondary" onPress={() => pick(() => picker.choosePhoto())} />
        <Button label="Choose a PDF" variant="secondary" onPress={() => pick(() => picker.choosePdf())} />
      </View>

      {file ? (
        <View style={styles.chosen}>
          {isImage ? <Image source={{ uri: file.uri }} accessibilityLabel="The chosen photo" style={styles.preview} resizeMode="cover" /> : null}
          <AppText variant="label">{file.name}</AppText>
          <AppText variant="caption" color={colors.inkSoft}>
            {kindOfFile(file) === 'pdf' ? 'PDF' : 'Photo'}
            {file.sizeBytes !== null ? ` · ${formatSize(file.sizeBytes)}` : ''}
          </AppText>
        </View>
      ) : null}
      {errors.file ? (
        <AppText variant="caption" color={colors.danger} accessibilityLiveRegion="polite" style={styles.fieldError}>
          {errors.file}
        </AppText>
      ) : null}

      <TextField
        label="Title"
        value={draft.title}
        onChangeText={(text) => change('title', text)}
        error={errors.title}
        placeholder="For example: Blood test, March"
        autoCapitalize="sentences"
      />

      <AppText variant="label" style={styles.sectionLabel}>
        Kind of document
      </AppText>
      <FilterChips
        accessibilityLabel="Kind of document"
        selected={draft.category === '' ? null : draft.category}
        onSelect={(value) => change('category', value)}
        options={HEALTH_RECORD_CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }))}
      />
      {errors.category ? (
        <AppText variant="caption" color={colors.danger} accessibilityLiveRegion="polite" style={styles.fieldError}>
          {errors.category}
        </AppText>
      ) : null}

      <TextField
        label="Date on the document (optional)"
        value={draft.recordedOn}
        onChangeText={(text) => change('recordedOn', text)}
        error={errors.recordedOn}
        placeholder="2026-10-29"
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
      />

      {needsClient ? (
        <>
          <AppText variant="label" style={styles.sectionLabel}>
            Who is this for?
          </AppText>
          <FilterChips
            accessibilityLabel="Who this document is for"
            selected={draft.patientId ?? null}
            onSelect={(value) => change('patientId', value)}
            options={people.map((person) => ({ value: person.id, label: person.name }))}
          />
          {errors.patientId ? (
            <AppText variant="caption" color={colors.danger} accessibilityLiveRegion="polite" style={styles.fieldError}>
              {errors.patientId}
            </AppText>
          ) : null}
        </>
      ) : null}

      {failure ? <Banner tone="error">{failure}</Banner> : null}

      <Button label={saving ? 'Uploading…' : 'Save document'} onPress={handleSave} loading={saving} />
    </>
  );
}

const styles = StyleSheet.create({
  back: { alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, marginBottom: spacing.xs },
  intro: { marginBottom: spacing.lg },
  pickers: { gap: spacing.sm, marginBottom: spacing.lg },
  chosen: {
    backgroundColor: colors.paper,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  preview: { width: '100%', height: 180, borderRadius: radius.field, backgroundColor: colors.mist },
  sectionLabel: { marginBottom: spacing.sm },
  fieldError: { marginBottom: spacing.sm },
});
