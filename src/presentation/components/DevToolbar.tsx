import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ROLES } from '../../domain/entities/Role';
import { policyFor } from '../../application/policies/policyFor';
import { useAuth } from '../providers/AuthProvider';
import { colors, radius, roleAccent, spacing } from '../theme/theme';
import { AppText } from './AppText';

/**
 * Floating panel for development: act as any role without signing in.
 * It renders nothing unless the app was started with dev controls,
 * which only happens in development builds.
 */
export function DevToolbar() {
  const { dev, user } = useAuth();
  const [expanded, setExpanded] = useState(false);

  if (!dev) return null;

  const accent = user ? roleAccent[user.role].foreground : colors.inkSoft;

  if (!expanded) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open developer tools"
        onPress={() => setExpanded(true)}
        style={[styles.collapsed, { backgroundColor: accent }]}
      >
        <AppText variant="label" color={colors.white}>
          {dev.isActive ? 'DEV' : 'dev'}
        </AppText>
      </Pressable>
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <AppText variant="label">Developer tools</AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close developer tools"
          onPress={() => setExpanded(false)}
          hitSlop={12}
        >
          <AppText variant="label" color={colors.harbor}>
            Close
          </AppText>
        </Pressable>
      </View>

      <AppText variant="caption" color={colors.inkSoft} style={styles.status}>
        {dev.isActive
          ? `Pretending to be: ${user ? policyFor(user.role).displayName : 'no one'}`
          : 'Using the real sign-in'}
      </AppText>

      {!dev.isActive ? (
        <ToolButton label="Turn on dev mode" onPress={() => dev.enable('patient')} />
      ) : (
        <>
          <AppText variant="caption" color={colors.inkSoft} style={styles.sectionTitle}>
            Switch role
          </AppText>
          {ROLES.map((role) => {
            const selected = user?.role === role;
            return (
              <ToolButton
                key={role}
                label={policyFor(role).displayName}
                selected={selected}
                tint={roleAccent[role].foreground}
                onPress={() => dev.switchRole(role)}
              />
            );
          })}
          <ToolButton label="Exit dev mode" onPress={() => void dev.disable()} />
        </>
      )}
    </View>
  );
}

function ToolButton({
  label,
  onPress,
  selected = false,
  tint = colors.harbor,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  tint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.toolButton,
        { borderColor: tint, backgroundColor: selected ? tint : colors.paper },
      ]}
    >
      <AppText variant="label" color={selected ? colors.white : tint}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  collapsed: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.xl,
    minWidth: 48,
    minHeight: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    zIndex: 9999,
    elevation: 8,
  },
  panel: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.xl,
    width: 232,
    backgroundColor: colors.paper,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.harbor,
    padding: spacing.md,
    gap: spacing.sm,
    zIndex: 9999,
    elevation: 8,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  status: { marginBottom: spacing.xs },
  sectionTitle: { marginTop: spacing.xs },
  toolButton: {
    minHeight: 44,
    borderRadius: radius.field,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
});
