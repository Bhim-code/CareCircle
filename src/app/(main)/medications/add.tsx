import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  QUICK_TIMES,
  blankMedicineDraft,
  formatTimeKey,
  validateMedicineDraft,
  MAX_TIMES,
  type MedicineDraft,
  type MedicineDraftErrors,
} from '@/application/medicines';
import { parseTimeText } from '@/application/recordEntries';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { Can } from '@/presentation/components/Can';
import { Screen } from '@/presentation/components/Screen';
import { TextField } from '@/presentation/components/TextField';
import { TextLink } from '@/presentation/components/TextLink';
import { useMedicineList } from '@/presentation/providers/MedicinesProvider';
import { colors, radius, spacing, touchTarget } from '@/presentation/theme/theme';

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/medications');
}

export default function AddMedicineScreen() {
  return (
    <Screen>
      <View style={styles.back}>
        <TextLink label="‹ Back" onPress={goBack} />
      </View>
      <AppText variant="title" style={styles.title}>
        Add a medicine
      </AppText>
      {/* Only patients manage their medicines. */}
      <Can permission="reminders.manage" showMessage>
        <AddMedicineForm />
      </Can>
    </Screen>
  );
}

/** "08:00" -> "8:00 AM" is what we type into the box, so it reads naturally. */
function boxText(time: string): string {
  return formatTimeKey(time);
}

function AddMedicineForm() {
  const { add } = useMedicineList();
  const [draft, setDraft] = useState<MedicineDraft>(() => blankMedicineDraft(new Date()));
  const [errors, setErrors] = useState<MedicineDraftErrors>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  function change<K extends keyof MedicineDraft>(field: K, value: MedicineDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function changeTime(index: number, text: string) {
    setDraft((current) => ({ ...current, times: current.times.map((old, i) => (i === index ? text : old)) }));
    setErrors((current) => ({ ...current, times: undefined, timeAt: undefined }));
  }

  function addTimeBox() {
    setDraft((current) => (current.times.length >= MAX_TIMES ? current : { ...current, times: [...current.times, ''] }));
  }

  function removeTimeBox(index: number) {
    setDraft((current) => ({ ...current, times: current.times.filter((_, i) => i !== index) }));
    setErrors((current) => ({ ...current, times: undefined, timeAt: undefined }));
  }

  /** A tap on "Morning", "Noon"... fills the first empty box, or makes a new one. */
  function addQuickTime(time: string) {
    setDraft((current) => {
      const already = current.times.some((text) => {
        const parsed = parseTimeText(text);
        return parsed && `${String(parsed.hours).padStart(2, '0')}:${String(parsed.minutes).padStart(2, '0')}` === time;
      });
      if (already) return current;
      const empty = current.times.findIndex((text) => text.trim() === '');
      if (empty >= 0) return { ...current, times: current.times.map((old, i) => (i === empty ? boxText(time) : old)) };
      return current.times.length >= MAX_TIMES ? current : { ...current, times: [...current.times, boxText(time)] };
    });
    setErrors((current) => ({ ...current, times: undefined, timeAt: undefined }));
  }

  async function handleSave() {
    const result = validateMedicineDraft(draft, new Date());
    if (!result.ok) {
      setErrors(result.errors);
      setFailure(null);
      return;
    }
    setSaving(true);
    setFailure(null);
    const saved = await add(result.input);
    setSaving(false);
    if (saved.ok) goBack();
    else setFailure(saved.message);
  }

  return (
    <>
      <AppText color={colors.inkSoft} style={styles.intro}>
        You will get a reminder at each time, every day, from the start date.
      </AppText>

      <TextField
        label="Medicine name"
        value={draft.name}
        onChangeText={(text) => change('name', text)}
        error={errors.name}
        placeholder="For example: Metformin"
        autoCapitalize="words"
      />

      <AppText variant="label" style={styles.sectionLabel}>
        Times of day
      </AppText>
      <View style={styles.chips}>
        {QUICK_TIMES.map((quick) => (
          <Pressable
            key={quick.time}
            accessibilityRole="button"
            accessibilityLabel={`Add ${quick.label}, ${formatTimeKey(quick.time)}`}
            onPress={() => addQuickTime(quick.time)}
            style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
          >
            <AppText variant="label" color={colors.harbor}>
              {quick.label} {formatTimeKey(quick.time)}
            </AppText>
          </Pressable>
        ))}
      </View>

      {draft.times.map((text, index) => (
        <View key={index}>
          <TextField
            label={`Time ${index + 1}`}
            value={text}
            onChangeText={(value) => changeTime(index, value)}
            error={errors.timeAt?.[index]}
            placeholder="8:00 AM or 20:30"
            autoCapitalize="characters"
            autoCorrect={false}
          />
          {draft.times.length > 1 ? (
            <View style={styles.removeRow}>
              <TextLink label={`Remove time ${index + 1}`} onPress={() => removeTimeBox(index)} />
            </View>
          ) : null}
        </View>
      ))}
      {errors.times ? (
        <AppText variant="caption" color={colors.danger} accessibilityLiveRegion="polite" style={styles.timesError}>
          {errors.times}
        </AppText>
      ) : null}
      {draft.times.length < MAX_TIMES ? (
        <View style={styles.addTime}>
          <Button label="Add another time" variant="secondary" onPress={addTimeBox} />
        </View>
      ) : null}

      <TextField
        label="Start date"
        value={draft.startDate}
        onChangeText={(text) => change('startDate', text)}
        error={errors.startDate}
        placeholder="2026-10-29"
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
      />
      <TextField
        label="End date (optional)"
        value={draft.endDate}
        onChangeText={(text) => change('endDate', text)}
        error={errors.endDate}
        placeholder="Leave empty if there is no end"
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
      />

      {failure ? <Banner tone="error">{failure}</Banner> : null}

      <Button label="Save medicine" onPress={handleSave} loading={saving} />
    </>
  );
}

const styles = StyleSheet.create({
  back: { alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, marginBottom: spacing.xs },
  intro: { marginBottom: spacing.lg },
  sectionLabel: { marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.harbor,
    backgroundColor: colors.paper,
  },
  chipPressed: { backgroundColor: colors.tint },
  removeRow: { alignItems: 'flex-start', marginTop: -spacing.sm, marginBottom: spacing.md },
  timesError: { marginBottom: spacing.sm },
  addTime: { marginBottom: spacing.lg },
});
