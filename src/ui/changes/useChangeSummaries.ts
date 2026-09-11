import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { loadChangeSummariesForModel, type ChangeListSummary } from '../../db/changeSummary';
import type { BranchRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export type ChangeSummariesState = { status: 'loading' } | { status: 'ready'; summaries: Map<UUID, ChangeListSummary> };

/**
 * Sprint 7i item 3's Changes-list card data — "affected capabilities" and
 * the describeEnvelope one-liner, batched for every branch `ChangesView.tsx`
 * is about to render at once (`loadChangeSummariesForModel`'s own doc
 * comment has the batch-vs-N+1 reasoning). A failed batch load degrades to
 * "no summary" on every card rather than blocking the list itself — the
 * branch rows/status/target date (`useChanges.ts`'s own state, the
 * load-bearing part of each card) render regardless — but it's still
 * reported, same convention every other model-scoped load failure in this
 * codebase already follows.
 */
export function useChangeSummaries(modelId: UUID, branches: readonly BranchRow[]): ChangeSummariesState {
  const [state, setState] = useState<ChangeSummariesState>({ status: 'loading' });

  useEffect(() => {
    if (branches.length === 0) {
      setState({ status: 'ready', summaries: new Map() });
      return undefined;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    loadChangeSummariesForModel(supabase, modelId, branches)
      .then((summaries) => {
        if (!cancelled) setState({ status: 'ready', summaries });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({ status: 'ready', summaries: new Map() });
          reportError(e instanceof Error ? `Couldn't load change summaries: ${e.message}` : "Couldn't load change summaries.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, branches]);

  return state;
}
