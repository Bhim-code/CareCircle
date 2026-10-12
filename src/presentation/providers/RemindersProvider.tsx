import React, { createContext, useContext, type ReactNode } from 'react';
import { dayKey } from '../../application/reminders';
import type { IReminderService } from '../../domain/services/IReminderService';
import { useNow } from '../hooks/useNow';
import { useReminders } from '../hooks/useReminders';
import { useAuth } from './AuthProvider';

type RemindersValue = ReturnType<typeof useReminders>;

const RemindersContext = createContext<RemindersValue | null>(null);

/**
 * Loads the signed-in patient's reminders for today once, so the Home screen and
 * the Medications screens always show the same thing (for example, right after
 * a dose is confirmed).
 */
export function RemindersProvider({ service, children }: { service: IReminderService; children: ReactNode }) {
  const { user, policy } = useAuth();
  const now = useNow();
  const value = useReminders(
    service,
    user?.id ?? '',
    dayKey(now),
    Boolean(user && policy?.can('reminders.manage')),
  );
  return <RemindersContext.Provider value={value}>{children}</RemindersContext.Provider>;
}

export function useTodaysReminders(): RemindersValue {
  const context = useContext(RemindersContext);
  if (!context) throw new Error('useTodaysReminders must be used inside <RemindersProvider>.');
  return context;
}
