import { useCallback, useEffect, useState } from 'react';
import { describeCareLinkError } from '../../application/careLinks';
import type { CareLink } from '../../domain/entities/CareLink';
import type { ICareLinkService } from '../../domain/services/ICareLinkService';

export type CareLinksStatus = 'loading' | 'ready' | 'error';

export type LinkResult = { ok: true } | { ok: false; message: string };

/** Loads the person's care links, and lets the screen invite, accept and remove. */
export function useCareLinks(service: ICareLinkService, userId: string, enabled = true) {
  const [status, setStatus] = useState<CareLinksStatus>('loading');
  const [links, setLinks] = useState<readonly CareLink[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setStatus('loading');
    service
      .list(userId)
      .then((loaded) => {
        if (!active) return;
        setLinks(loaded);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setLinks([]);
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [service, userId, enabled, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const invite = useCallback(
    async (email: string): Promise<LinkResult> => {
      try {
        const link = await service.invite(userId, email);
        setLinks((current) => [link, ...current]);
        return { ok: true };
      } catch (error) {
        return { ok: false, message: describeCareLinkError(error) };
      }
    },
    [service, userId],
  );

  const accept = useCallback(
    async (linkId: string): Promise<LinkResult> => {
      try {
        const link = await service.accept(userId, linkId);
        setLinks((current) => current.map((item) => (item.id === linkId ? link : item)));
        return { ok: true };
      } catch (error) {
        return { ok: false, message: describeCareLinkError(error) };
      }
    },
    [service, userId],
  );

  const remove = useCallback(
    async (linkId: string): Promise<LinkResult> => {
      try {
        await service.remove(userId, linkId);
        setLinks((current) => current.filter((item) => item.id !== linkId));
        return { ok: true };
      } catch (error) {
        return { ok: false, message: describeCareLinkError(error) };
      }
    },
    [service, userId],
  );

  return { status, links, retry, invite, accept, remove };
}
