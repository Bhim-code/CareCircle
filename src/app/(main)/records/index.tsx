import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  RECORD_FILTERS,
  categoryLabel,
  countByFilter,
  emptyMessageFor,
  filterLabel,
  filterRecords,
  formatRecordDate,
  sortRecords,
  type RecordFilter,
} from '@/application/healthRecords';
import {
  ENTRY_FILTERS,
  KIND_HELP,
  KIND_LABEL,
  addableKinds,
  canEditEntry,
  countEntries,
  entryEmptyMessage,
  entryFilterLabel,
  filterEntries,
  sortEntries,
  type EntryFilter,
} from '@/application/recordEntries';
import { createHealthRecordService } from '@/container';
import type { EntryKind } from '@/domain/entities/RecordEntry';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { Can } from '@/presentation/components/Can';
import { Card } from '@/presentation/components/Card';
import { EntryCard } from '@/presentation/components/EntryCard';
import { FilterChips } from '@/presentation/components/FilterChips';
import { Screen } from '@/presentation/components/Screen';
import { useHealthRecords } from '@/presentation/hooks/useHealthRecords';
import { useAuth } from '@/presentation/providers/AuthProvider';
import { useEntries } from '@/presentation/providers/RecordEntriesProvider';
import { colors, radius, roleAccent, spacing } from '@/presentation/theme/theme';

type Section = 'entries' | 'documents';

export default function HealthRecordsScreen() {
  const { user, policy } = useAuth();
  const [section, setSection] = useState<Section>('entries');

  // The route guard guarantees a signed-in user; this keeps TypeScript honest.
  if (!user || !policy) return null;

  const accent = roleAccent[user.role].foreground;
  const canSeeDocuments = policy.can('records.view');
  const canSeeEntries = policy.can('entries.view');

  return (
    <Screen>
      <AppText variant="title" style={styles.title}>
        {canSeeDocuments ? 'My health records' : 'Health records'}
      </AppText>

      <AddRecordButtons kinds={addableKinds(policy)} />

      {/* Patients have two lists: written records and scanned documents. Caregivers have only the first. */}
      {canSeeEntries && canSeeDocuments ? (
        <FilterChips<Section>
          accessibilityLabel="Choose a list"
          selected={section}
          onSelect={setSection}
          options={[
            { value: 'entries', label: 'Records' },
            { value: 'documents', label: 'Documents' },
          ]}
        />
      ) : null}

      {canSeeEntries && (section === 'entries' || !canSeeDocuments) ? <EntriesList /> : null}

      {/* Only roles with the permission ever reach the part that loads documents. */}
      {canSeeDocuments && section === 'documents' ? (
        <Can permission="records.view" showMessage>
          <RecordsList userId={user.id} accent={accent} />
        </Can>
      ) : null}
    </Screen>
  );
}

/**
 * One "Add a record" button. Pressing it opens the choices, so the list stays
 * near the top of the screen. A role only sees the kinds it is allowed to write.
 */
function AddRecordButtons({ kinds }: { kinds: EntryKind[] }) {
  const [open, setOpen] = useState(false);
  if (kinds.length === 0) return null;
  return (
    <View style={styles.addBox}>
      <Button label={open ? 'Close' : 'Add a record'} variant={open ? 'secondary' : 'primary'} onPress={() => setOpen((current) => !current)} />
      {open ? (
        <View style={styles.choices} accessibilityLabel="Kinds of record you can add">
          <AppText variant="label" style={styles.addHeading}>
            What would you like to record?
          </AppText>
          {kinds.map((kind) => (
            <Pressable
              key={kind}
              accessibilityRole="button"
              accessibilityLabel={`Add ${KIND_LABEL[kind].toLowerCase()}`}
              onPress={() => {
                setOpen(false);
                router.push({ pathname: '/records/entry', params: { kind } });
              }}
              style={({ pressed }) => [styles.addTile, pressed && styles.addTilePressed]}
            >
              <AppText variant="label" color={colors.harbor}>
                {KIND_LABEL[kind]}
              </AppText>
              <AppText variant="caption" color={colors.inkSoft}>
                {KIND_HELP[kind]}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The written records: incidents, medical, behavioural and medication notes. */
function EntriesList() {
  const { user, policy } = useAuth();
  const { status, entries, retry } = useEntries();
  const [filter, setFilter] = useState<EntryFilter>('all');

  const counts = useMemo(() => countEntries(entries), [entries]);
  const shown = useMemo(() => sortEntries(filterEntries(entries, filter)), [entries, filter]);

  if (!user || !policy) return null;

  if (status === 'loading') {
    return (
      <AppText color={colors.inkSoft} accessibilityLiveRegion="polite">
        Loading records…
      </AppText>
    );
  }

  if (status === 'error') {
    return (
      <>
        <Banner tone="error">We could not load the records. Please try again.</Banner>
        <Button label="Try again" variant="secondary" onPress={retry} />
      </>
    );
  }

  return (
    <>
      {entries.length > 0 ? (
        <FilterChips
          accessibilityLabel="Filter by type of record"
          selected={filter}
          onSelect={setFilter}
          options={ENTRY_FILTERS.map((value) => ({
            value,
            label: entryFilterLabel(value),
            count: counts[value],
          }))}
        />
      ) : null}

      {shown.length === 0 ? (
        <Card title="Nothing here yet">
          <AppText color={colors.inkSoft}>{entryEmptyMessage(filter, entries.length)}</AppText>
        </Card>
      ) : (
        shown.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            onEdit={
              canEditEntry(policy, user, entry)
                ? () => router.push({ pathname: '/records/entry', params: { kind: entry.kind, id: entry.id } })
                : undefined
            }
          />
        ))
      )}
    </>
  );
}

function RecordsList({ userId, accent }: { userId: string; accent: string }) {
  const [service] = useState(createHealthRecordService);
  const { status, records, retry } = useHealthRecords(service, userId);
  const [filter, setFilter] = useState<RecordFilter>('all');

  const counts = useMemo(() => countByFilter(records), [records]);
  const shown = useMemo(() => sortRecords(filterRecords(records, filter)), [records, filter]);

  if (status === 'loading') {
    return (
      <AppText color={colors.inkSoft} accessibilityLiveRegion="polite">
        Loading your records…
      </AppText>
    );
  }

  if (status === 'error') {
    return (
      <>
        <Banner tone="error">We could not load your records. Please try again.</Banner>
        <Button label="Try again" variant="secondary" onPress={retry} />
      </>
    );
  }

  return (
    <>
      {/* With no records at all, a row of "(0)" choices would only be clutter. */}
      {records.length > 0 ? (
        <FilterChips
          accessibilityLabel="Filter by document type"
          selected={filter}
          onSelect={setFilter}
          options={RECORD_FILTERS.map((value) => ({
            value,
            label: filterLabel(value),
            count: counts[value],
          }))}
        />
      ) : null}

      {shown.length === 0 ? (
        <Card title={filter === 'all' ? 'Nothing here yet' : filterLabel(filter)} accent={accent}>
          <AppText color={colors.inkSoft}>{emptyMessageFor(filter, records.length)}</AppText>
        </Card>
      ) : (
        shown.map((record) => (
          <Card key={record.id} title={record.title} accent={accent}>
            <AppText>{categoryLabel(record.category)}</AppText>
            <AppText variant="caption" color={colors.inkSoft}>
              {formatRecordDate(record.recordedOn)}
            </AppText>
          </Card>
        ))
      )}

      <AppText variant="caption" color={colors.inkSoft} style={styles.note}>
        Only you can see these records.
      </AppText>
    </>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: spacing.sm, marginBottom: spacing.lg },
  addBox: { marginBottom: spacing.lg },
  choices: { marginTop: spacing.md },
  addHeading: { marginBottom: spacing.sm },
  addTile: {
    minHeight: 56,
    backgroundColor: colors.paper,
    borderWidth: 2,
    borderColor: colors.harbor,
    borderRadius: radius.button,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    justifyContent: 'center',
  },
  addTilePressed: { backgroundColor: colors.tint },
  note: { marginTop: spacing.sm, marginBottom: spacing.lg, textAlign: 'center' },
});
