import { useCallback, useEffect, useState } from 'react';
import { createModel, listModelsForOrg } from '../../db/models';
import type { ModelRow } from '../../db/types';
import type { UUID } from '../../contracts/delta';
import { supabase } from '../supabaseClient';

export interface UseModelsResult {
  models: ModelRow[];
  loading: boolean;
  error: string | null;
  createModel: (name: string, slug: string, createdBy: UUID) => Promise<ModelRow>;
}

export function useModels(orgId: UUID | null): UseModelsResult {
  const [models, setModels] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) {
      setModels([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listModelsForOrg(supabase, orgId)
      .then((rows) => {
        if (!cancelled) setModels(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load models');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const create = useCallback(
    async (name: string, slug: string, createdBy: UUID) => {
      if (!orgId) throw new Error('useModels: cannot create a model without an organisation');
      const model = await createModel(supabase, { id: crypto.randomUUID(), orgId, name, slug, createdBy });
      setModels((prev) => [...prev, model].sort((a, b) => a.name.localeCompare(b.name)));
      return model;
    },
    [orgId],
  );

  return { models, loading, error, createModel: create };
}
