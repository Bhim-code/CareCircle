import { useCallback, useEffect, useState } from 'react';
import { describeDocumentError } from '../../application/documents';
import type { DocumentUpload, HealthRecord } from '../../domain/entities/HealthRecord';
import type { Person } from '../../domain/entities/Person';
import type { IHealthRecordService } from '../../domain/services/IHealthRecordService';

export type RecordsStatus = 'loading' | 'ready' | 'error';

export type DocumentResult<T = void> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Loads one person's health documents, and lets screens add, delete and open them.
 * Nothing is requested when `enabled` is false (the person may not see documents).
 */
export function useHealthRecords(service: IHealthRecordService, userId: string, enabled = true) {
  const [status, setStatus] = useState<RecordsStatus>('loading');
  const [records, setRecords] = useState<readonly HealthRecord[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setRecords([]);
      setStatus('ready');
      return;
    }
    let active = true;
    setStatus('loading');
    service
      .list(userId)
      .then((loaded) => {
        if (!active) return;
        setRecords(loaded);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setRecords([]);
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [service, userId, enabled, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const upload = useCallback(
    async (input: DocumentUpload): Promise<DocumentResult<HealthRecord>> => {
      try {
        const saved = await service.upload(userId, input);
        setRecords((current) => [saved, ...current.filter((record) => record.id !== saved.id)]);
        return { ok: true, value: saved };
      } catch (error) {
        return { ok: false, message: describeDocumentError(error) };
      }
    },
    [service, userId],
  );

  const remove = useCallback(
    async (recordId: string): Promise<DocumentResult> => {
      try {
        await service.remove(userId, recordId);
        setRecords((current) => current.filter((record) => record.id !== recordId));
        return { ok: true, value: undefined };
      } catch (error) {
        return { ok: false, message: describeDocumentError(error) };
      }
    },
    [service, userId],
  );

  /** A new link to the file, because the one in the list expires after about 15 minutes. */
  const freshLink = useCallback(
    async (recordId: string): Promise<DocumentResult<string>> => {
      try {
        const link = await service.freshLink(userId, recordId);
        if (!link) return { ok: false, message: 'This document has no file to open.' };
        return { ok: true, value: link };
      } catch (error) {
        return { ok: false, message: describeDocumentError(error) };
      }
    },
    [service, userId],
  );

  const clients = useCallback(async (): Promise<readonly Person[]> => {
    try {
      return await service.clients(userId);
    } catch {
      return [];
    }
  }, [service, userId]);

  return { status, records, retry, upload, remove, freshLink, clients };
}
