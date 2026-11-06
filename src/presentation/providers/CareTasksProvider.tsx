import React, { createContext, useContext, type ReactNode } from 'react';
import { TASKS_VIEW, hasPermission } from '../../application/careTasks';
import type { ICareTaskService } from '../../domain/services/ICareTaskService';
import { useCareTasks } from '../hooks/useCareTasks';
import { useAuth } from './AuthProvider';

type CareTasksValue = ReturnType<typeof useCareTasks>;

const CareTasksContext = createContext<CareTasksValue | null>(null);

/** Loads today's care tasks once, for a person who may see them, so the Tasks screens agree. */
export function CareTasksProvider({ service, children }: { service: ICareTaskService; children: ReactNode }) {
  const { user } = useAuth();
  const value = useCareTasks(service, user?.id ?? '', Boolean(user && hasPermission(user.permissions, TASKS_VIEW)));
  return <CareTasksContext.Provider value={value}>{children}</CareTasksContext.Provider>;
}

export function useCareTaskList(): CareTasksValue {
  const context = useContext(CareTasksContext);
  if (!context) throw new Error('useCareTaskList must be used inside <CareTasksProvider>.');
  return context;
}
