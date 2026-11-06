import React, { createContext, useContext, type ReactNode } from 'react';
import { DOCUMENTS_VIEW } from '../../application/documents';
import { hasPermission } from '../../application/careTasks';
import type { IHealthRecordService } from '../../domain/services/IHealthRecordService';
import { useHealthRecords } from '../hooks/useHealthRecords';
import { useAuth } from './AuthProvider';

type DocumentsValue = ReturnType<typeof useHealthRecords>;

const DocumentsContext = createContext<DocumentsValue | null>(null);

/** Loads the health documents once, for a person who may see them, so the list and its screens agree. */
export function HealthRecordsProvider({ service, children }: { service: IHealthRecordService; children: ReactNode }) {
  const { user } = useAuth();
  const value = useHealthRecords(service, user?.id ?? '', Boolean(user && hasPermission(user.permissions, DOCUMENTS_VIEW)));
  return <DocumentsContext.Provider value={value}>{children}</DocumentsContext.Provider>;
}

export function useDocumentList(): DocumentsValue {
  const context = useContext(DocumentsContext);
  if (!context) throw new Error('useDocumentList must be used inside <HealthRecordsProvider>.');
  return context;
}
