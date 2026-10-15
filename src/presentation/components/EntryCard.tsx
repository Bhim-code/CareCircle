import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import {
  KIND_LABEL,
  MOOD_LABEL,
  SEVERITY_LABEL,
  editedNote,
  formatStamp,
} from '../../application/recordEntries';
import type { EntryKind, RecordEntry } from '../../domain/entities/RecordEntry';
import { colors, radius, spacing } from '../theme/theme';
import { AppText } from './AppText';
import { Button } from './Button';

/** Colour of the left edge. The kind is always written out too, so colour is never the only clue. */
const KIND_ACCENT: Record<EntryKind, { edge: string; tint: string; text: string }> = {
  medical: { edge: colors.harbor, tint: colors.tint, text: colors.harbor },
  behavioural: { edge: colors.amber, tint: colors.amberTint, text: colors.amber },
  incident: { edge: colors.danger, tint: colors.dangerTint, text: colors.danger },
  medication: { edge: colors.success, tint: colors.successTint, text: colors.success },
};

function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.detail}>
      <AppText variant="caption" color={colors.inkSoft}>
        {label}
      </AppText>
      <AppText>{value}</AppText>
    </View>
  );
}

interface EntryCardProps {
  entry: RecordEntry;
  /** Shows the Edit button. */
  onEdit?: () => void;
}

/** One written record: what it is, when it happened, the details, who wrote it, and whether it was edited. */
export function EntryCard({ entry, onEdit }: EntryCardProps) {
  const look = KIND_ACCENT[entry.kind];
  const edited = editedNote(entry);

  return (
    <View style={[styles.card, { borderLeftColor: look.edge }]}>
      <View style={[styles.pill, { backgroundColor: look.tint }]}>
        <AppText variant="caption" color={look.text} style={styles.pillText}>
          {KIND_LABEL[entry.kind]}
        </AppText>
      </View>
      <AppText variant="heading" style={styles.title}>
        {entry.title}
      </AppText>
      <AppText variant="caption" color={colors.inkSoft} style={styles.when}>
        {formatStamp(entry.occurredAt)}
      </AppText>

      <Detail label="Client" value={entry.clientName} />
      {entry.severity ? <Detail label="Seriousness" value={SEVERITY_LABEL[entry.severity]} /> : null}
      {entry.mood ? <Detail label="Mood" value={MOOD_LABEL[entry.mood]} /> : null}
      {entry.kind === 'medication' ? <Detail label="Medicine" value={entry.medicineName} /> : null}
      <Detail label={entry.kind === 'incident' ? 'What happened' : 'Details'} value={entry.notes || null} />
      <Detail label="Action taken" value={entry.actionTaken} />
      <Detail label="Witness" value={entry.witnessName} />

      {entry.photoUri ? (
        <Image
          accessibilityLabel={`Photo of ${entry.medicineName ?? 'the medicine'}`}
          source={{ uri: entry.photoUri }}
          style={styles.photo}
          resizeMode="cover"
        />
      ) : null}

      <AppText variant="caption" color={colors.inkSoft} style={styles.meta}>
        Recorded {formatStamp(entry.recordedAt)} by {entry.recordedBy.name}
      </AppText>
      {edited ? (
        <View style={styles.edited}>
          <AppText variant="caption" color={colors.amber} style={styles.pillText}>
            {edited}
          </AppText>
        </View>
      ) : null}

      {onEdit ? (
        <View style={styles.editRow}>
          <Button label="Edit" variant="secondary" onPress={onEdit} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paper,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 6,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
  },
  pillText: { fontWeight: '700' },
  title: { marginBottom: spacing.xs },
  when: { marginBottom: spacing.sm },
  detail: { marginTop: spacing.sm },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.field,
    marginTop: spacing.md,
    backgroundColor: colors.mist,
  },
  meta: { marginTop: spacing.md },
  edited: {
    alignSelf: 'flex-start',
    backgroundColor: colors.amberTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    marginTop: spacing.sm,
  },
  editRow: { marginTop: spacing.md },
});
