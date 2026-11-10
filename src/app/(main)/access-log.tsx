import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { describeAction, describeRole, groupByDay, timeLabel } from '@/application/accessLog';
import { createAccessLogService } from '@/container';
import { AppText } from '@/presentation/components/AppText';
import { Banner } from '@/presentation/components/Banner';
import { Button } from '@/presentation/components/Button';
import { Screen } from '@/presentation/components/Screen';
import { TextLink } from '@/presentation/components/TextLink';
import { InlineLoading } from '@/presentation/components/InlineLoading';
import { useAccessLog } from '@/presentation/hooks/useAccessLog';
import { useAuth } from '@/presentation/providers/AuthProvider';
import { colors, radius, spacing } from '@/presentation/theme/theme';

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/profile');
}

/** For patients: who has looked at their records, and when. */
export default function AccessLogScreen() {
  const { user, policy } = useAuth();
  const [service] = useState(createAccessLogService);
  // Only patients (who manage their own caregivers) have this list.
  const allowed = Boolean(user && policy?.can('caregivers.manage'));
  const { status, views, message, retry } = useAccessLog(service, user?.id ?? '', allowed);
  const days = useMemo(() => groupByDay(views, new Date()), [views]);

  if (!user || !policy) return null;

  return (
    <Screen>
      <View style={styles.back}>
        <TextLink label="‹ Back" onPress={goBack} />
      </View>
      <AppText variant="title" style={styles.title}>
        Who has viewed my records
      </AppText>
      <AppText color={colors.inkSoft} style={styles.intro}>
        Your caregivers and the staff who look after your account can open your records. This is the list of the latest times they did. Your own views are not shown.
      </AppText>

      {!allowed ? <Banner tone="error">Only patients can see who has viewed their records.</Banner> : null}

      {allowed && status === 'loading' ? (
        <InlineLoading label="Loading…" />
      ) : null}

      {allowed && status === 'error' ? (
        <>
          <Banner tone="error">{message}</Banner>
          <Button label="Try again" variant="secondary" onPress={retry} />
        </>
      ) : null}

      {allowed && status === 'ready' && days.length === 0 ? (
        <AppText color={colors.inkSoft}>Nobody has viewed your records yet.</AppText>
      ) : null}

      {allowed && status === 'ready'
        ? days.map((day) => (
            <View key={day.label}>
              <AppText variant="heading" style={styles.sectionTitle}>
                {day.label}
              </AppText>
              {day.views.map((view, index) => (
                <View key={`${view.at}-${index}`} style={styles.row}>
                  <AppText variant="heading">{view.viewer.name}</AppText>
                  <AppText color={colors.inkSoft}>{describeRole(view.viewer.role)}</AppText>
                  <AppText>{describeAction(view.action)}</AppText>
                  <AppText variant="caption" color={colors.inkSoft}>
                    {timeLabel(view.at)}
                  </AppText>
                </View>
              ))}
            </View>
          ))
        : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, marginBottom: spacing.xs },
  intro: { marginBottom: spacing.lg },
  sectionTitle: { marginTop: spacing.lg, marginBottom: spacing.sm },
  row: {
    backgroundColor: colors.paper,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
});
