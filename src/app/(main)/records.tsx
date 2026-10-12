import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
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
import { createHealthRecordService } from '@/container';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { Can } from '@/presentation/components/Can';
import { Card } from '@/presentation/components/Card';
import { FilterChips } from '@/presentation/components/FilterChips';
import { Screen } from '@/presentation/components/Screen';
import { useHealthRecords } from '@/presentation/hooks/useHealthRecords';
import { useAuth } from '@/presentation/providers/AuthProvider';
import { colors, roleAccent, spacing } from '@/presentation/theme/theme';

export default function HealthRecordsScreen() {
  const { user } = useAuth();

  // The route guard guarantees a signed-in user; this keeps TypeScript honest.
  if (!user) return null;

  return (
    <Screen>
      <AppText variant="title" style={styles.title}>
        My health records
      </AppText>

      {/* Only roles with the permission ever reach the part that loads records. */}
      <Can permission="records.view" showMessage>
        <RecordsList userId={user.id} accent={roleAccent[user.role].foreground} />
      </Can>
    </Screen>
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
  note: { marginTop: spacing.sm, marginBottom: spacing.lg, textAlign: 'center' },
});
