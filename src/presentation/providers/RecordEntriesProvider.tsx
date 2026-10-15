import React, { createContext, useContext, type ReactNode } from 'react';
import type { IRecordEntryService } from '../../domain/services/IRecordEntryService';
import { useRecordEntries } from '../hooks/useRecordEntries';
import { useAuth } from './AuthProvider';

type EntriesValue = ReturnType<typeof useRecordEntries>;

const RecordEntriesContext = createContext<EntriesValue | null>(null);

/**
 * Loads the written records once, so the Records list and the add/edit form
 * always agree (for example, right after a record is saved).
 */
export function RecordEntriesProvider({ service, children }: { service: IRecordEntryService; children: ReactNode }) {
  const { user, policy } = useAuth();
  const value = useRecordEntries(service, user?.id ?? '', Boolean(user && policy?.can('entries.view')));
  return <RecordEntriesContext.Provider value={value}>{children}</RecordEntriesContext.Provider>;
}

export function useEntries(): EntriesValue {
  const context = useContext(RecordEntriesContext);
  if (!context) throw new Error('useEntries must be used inside <RecordEntriesProvider>.');
  return context;
}
