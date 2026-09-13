import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getOpenMergeRequestForBranch } from '../../db/mergeRequests';
import type { MergeRequestRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface UseOpenMergeRequestResult {
  /** `undefined` while loading, `null` once loaded with no open request. */
  request: MergeRequestRow | null | undefined;
  reload: () => void;
}

/** The change page's own link into the review queue, once this branch has one open (Sprint C1 step 7). */
export function useOpenMergeRequest(branchId: UUID): UseOpenMergeRequestResult {
  const [request, setRequest] = useState<MergeRequestRow | null | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRequest(undefined);
    getOpenMergeRequestForBranch(supabase, branchId)
      .then((row) => {
        if (!cancelled) setRequest(row);
      })
      .catch((e: unknown) => {
        reportError("Couldn't check for an open review request.", e);
        if (!cancelled) setRequest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  return { request, reload };
}
