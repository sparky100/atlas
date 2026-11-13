import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ConnectorFetchResponse, ConnectorKind, ConnectorRow } from '../../contracts/connectors';
import { listConnectors, removeConnector, runConnector, saveConnector } from '../../db/connectors';
import { supabase } from '../supabaseClient';

export interface UseConnectorsResult {
  connectors: ConnectorRow[];
  loading: boolean;
  /** `null` when saved; otherwise the plain-English reason. */
  save: (kind: ConnectorKind, config: Record<string, unknown>, secret: string) => Promise<string | null>;
  remove: (kind: ConnectorKind) => Promise<string | null>;
  test: (kind: ConnectorKind) => Promise<ConnectorFetchResponse>;
}

/** Owners and architects read; pass `null` for anyone else and nothing is read. */
export function useConnectors(orgId: UUID | null): UseConnectorsResult {
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [loading, setLoading] = useState(orgId !== null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!orgId) {
      setConnectors([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listConnectors(supabase, orgId)
      .then((rows) => {
        if (!cancelled) setConnectors(rows);
      })
      .catch((e: unknown) => {
        console.error('could not load connectors', e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // reloadToken is a deliberate refetch trigger, not a value the effect reads.
  }, [orgId, reloadToken]);

  const save = useCallback(
    async (kind: ConnectorKind, config: Record<string, unknown>, secret: string) => {
      if (!orgId) return 'No organisation.';
      try {
        await saveConnector(supabase, orgId, kind, config, secret);
        setReloadToken((t) => t + 1);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : 'Could not save.';
      }
    },
    [orgId],
  );

  const remove = useCallback(
    async (kind: ConnectorKind) => {
      if (!orgId) return 'No organisation.';
      try {
        await removeConnector(supabase, orgId, kind);
        setReloadToken((t) => t + 1);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : 'Could not remove.';
      }
    },
    [orgId],
  );

  const test = useCallback(
    async (kind: ConnectorKind) => {
      const result = orgId ? await runConnector(supabase, orgId, kind, 'test') : ({ status: 'error', code: 'invalid', message: 'No organisation.' } as const);
      setReloadToken((t) => t + 1);
      return result;
    },
    [orgId],
  );

  return { connectors, loading, save, remove, test };
}
