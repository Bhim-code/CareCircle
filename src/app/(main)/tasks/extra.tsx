import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { validateExtra, type ExtraErrors } from '@/application/careTasks';
import { TASKS_COMPLETE } from '@/application/permissions';
import { usePermission } from '@/presentation/hooks/usePermission';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { Screen } from '@/presentation/components/Screen';
import { TextField } from '@/presentation/components/TextField';
import { TextLink } from '@/presentation/components/TextLink';
import { useCareTaskList } from '@/presentation/providers/CareTasksProvider';
import { colors, spacing } from '@/presentation/theme/theme';

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/tasks');
}

/** Write down work that was done but was not in the plan, such as "Walk to the park". */
export default function ExtraWorkScreen() {
  const { addExtra } = useCareTaskList();
  const params = useLocalSearchParams<{ clientId?: string; clientName?: string }>();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<ExtraErrors>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const allowed = usePermission(TASKS_COMPLETE);

  async function handleSave() {
    const check = validateExtra(title, note, params.clientId);
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    setFailure(null);
    const result = await addExtra(check.input);
    setSaving(false);
    if (result.ok) goBack();
    else setFailure(result.message);
  }

  return (
    <Screen>
      <View style={styles.back}>
        <TextLink label="‹ Back" onPress={goBack} />
      </View>
      <AppText variant="title" style={styles.title}>
        Log extra work
      </AppText>
      {!allowed ? (
        <Banner tone="info">Your account cannot log care work.</Banner>
      ) : (
        <>
          <AppText color={colors.inkSoft} style={styles.intro}>
            {params.clientName ? `For ${params.clientName}. ` : ''}Write down something that was done today that was not in the plan.
          </AppText>
          <TextField
            label="What was done"
            value={title}
            onChangeText={(text) => {
              setTitle(text);
              setErrors((current) => ({ ...current, title: undefined }));
            }}
            error={errors.title}
            placeholder="For example: Walk to the park"
            maxLength={100}
          />
          <TextField
            label="Note (optional)"
            value={note}
            onChangeText={(text) => {
              setNote(text);
              setErrors((current) => ({ ...current, note: undefined }));
            }}
            error={errors.note}
            multiline
          />
          {failure ? <Banner tone="error">{failure}</Banner> : null}
          <Button label="Save" onPress={handleSave} loading={saving} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, marginBottom: spacing.xs },
  intro: { marginBottom: spacing.lg },
});
