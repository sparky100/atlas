import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ApiKeyRow, CreatedApiKey } from '../../contracts/api';
import { createApiKey, listApiKeys, revokeApiKey } from '../../db/apiKeys';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface UseApiKeysResult {
  keys: ApiKeyRow[];
  loading: boolean;
  error: string | null;
  /** The new key, with its full text (shown once), or `null` on failure (the message is in `error`). */
  create: (name: string) => Promise<CreatedApiKey | null>;
  revoke: (id: UUID) => Promise<void>;
}

/** Owners only: pass `null` for anyone else and nothing is read. */
export function useApiKeys(orgId: UUID | null): UseApiKeysResult {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(orgId !== null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!orgId) {
      setKeys([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listApiKeys(supabase, orgId)
      .then((rows) => {
        if (!cancelled) setKeys(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load API keys.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // reloadToken is a deliberate refetch trigger, not a value the effect reads.
  }, [orgId, reloadToken]);

  const create = useCallback(
    async (name: string) => {
      if (!orgId) return null;
      setError(null);
      try {
        const created = await createApiKey(supabase, orgId, name);
        setReloadToken((t) => t + 1);
        return created;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create the key.');
        return null;
      }
    },
    [orgId],
  );

  const revoke = useCallback(async (id: UUID) => {
    setError(null);
    try {
      await revokeApiKey(supabase, id);
      setReloadToken((t) => t + 1);
    } catch (e) {
      reportError('Could not revoke the key.', e);
      setError(e instanceof Error ? e.message : 'Could not revoke the key.');
    }
  }, []);

  return { keys, loading, error, create, revoke };
}
