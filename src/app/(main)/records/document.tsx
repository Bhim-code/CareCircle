import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Image, Linking, StyleSheet, View } from 'react-native';
import { canDelete, describeDocumentError, fileSummary } from '@/application/documents';
import { categoryLabel, formatRecordDate } from '@/application/healthRecords';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { Card } from '@/presentation/components/Card';
import { Screen } from '@/presentation/components/Screen';
import { TextLink } from '@/presentation/components/TextLink';
import { useAuth } from '@/presentation/providers/AuthProvider';
import { useDocumentList } from '@/presentation/providers/HealthRecordsProvider';
import { colors, radius, spacing } from '@/presentation/theme/theme';

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/records');
}

export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuth();
  const { status, records, remove, freshLink } = useDocumentList();
  const record = records.find((item) => item.id === id);
  const [link, setLink] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // The link in the list may be old, so ask for a new one when the screen opens.
  useEffect(() => {
    if (!record || !record.fileType) return;
    let active = true;
    freshLink(record.id).then((result) => {
      if (!active) return;
      if (result.ok) setLink(result.value);
      else setFailure(result.message);
    });
    return () => {
      active = false;
    };
  }, [record?.id, record?.fileType, freshLink]);

  async function handleDelete() {
    if (!record) return;
    setDeleting(true);
    setFailure(null);
    const result = await remove(record.id);
    setDeleting(false);
    setConfirming(false);
    if (result.ok) goBack();
    else setFailure(result.message);
  }

  async function openPdf() {
    if (!link) return;
    try {
      await Linking.openURL(link);
    } catch (error) {
      setFailure(describeDocumentError(error));
    }
  }

  return (
    <Screen>
      <View style={styles.back}>
        <TextLink label="‹ Back" onPress={goBack} />
      </View>

      {!record ? (
        <>
          <AppText variant="title" style={styles.title}>
            Document
          </AppText>
          {status === 'loading' ? (
            <AppText color={colors.inkSoft}>Loading…</AppText>
          ) : (
            <Banner tone="error">This document is no longer in your list.</Banner>
          )}
        </>
      ) : (
        <>
          <AppText variant="title" style={styles.title}>
            {record.title}
          </AppText>
          <Card title={categoryLabel(record.category)}>
            <AppText color={colors.inkSoft}>{formatRecordDate(record.recordedOn)}</AppText>
            <AppText variant="caption" color={colors.inkSoft}>
              {fileSummary(record)}
              {record.uploadedBy ? ` · Added by ${record.uploadedBy.name}` : ''}
            </AppText>
          </Card>

          {record.fileType === 'image' && link ? (
            <Image source={{ uri: link }} accessibilityLabel={record.title} style={styles.image} resizeMode="contain" />
          ) : null}
          {record.fileType === 'pdf' ? <Button label="Open the PDF" onPress={openPdf} disabled={!link} /> : null}
          {record.fileType && !link && !failure ? (
            <AppText color={colors.inkSoft} accessibilityLiveRegion="polite">
              Getting the file…
            </AppText>
          ) : null}

          {failure ? <Banner tone="error">{failure}</Banner> : null}

          {user && canDelete(record, user.id) ? (
            confirming ? (
              <View style={styles.confirm}>
                <AppText variant="label">Delete this document? This cannot be undone.</AppText>
                <Button label="Yes, delete it" variant="danger" loading={deleting} onPress={handleDelete} />
                <Button label="Keep it" variant="secondary" onPress={() => setConfirming(false)} />
              </View>
            ) : (
              <Button label="Delete document" variant="secondary" onPress={() => setConfirming(true)} />
            )
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, marginBottom: spacing.md },
  image: { width: '100%', height: 360, borderRadius: radius.card, backgroundColor: colors.paper, marginVertical: spacing.md },
  confirm: { gap: spacing.sm, marginTop: spacing.lg },
});
