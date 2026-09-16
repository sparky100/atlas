import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { listModelsSharedWithOrg, type ModelSharedWithOrg } from '../../db/modelShares';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface UseModelsSharedWithOrgResult {
  sharedModels: ModelSharedWithOrg[];
  loading: boolean;
}

/** OrgHome's "Shared with us" section (F7 item 4) — every model shared into this org from elsewhere. */
export function useModelsSharedWithOrg(orgId: UUID | null): UseModelsSharedWithOrgResult {
  const [sharedModels, setSharedModels] = useState<ModelSharedWithOrg[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setSharedModels([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listModelsSharedWithOrg(supabase, orgId)
      .then((rows) => {
        if (!cancelled) setSharedModels(rows);
      })
      .catch((e: unknown) => {
        reportError('Could not load models shared with this organisation.', e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return { sharedModels, loading };
}
