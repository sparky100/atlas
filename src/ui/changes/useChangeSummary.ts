import { NO_IMPACT_PROBLEMS } from '../../engine/changeImpactProblems';
import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { resolveChangeLineage, type ChangeLineage } from '../../db/branches';
import { loadChangeSummary, type ChangeSummary } from '../../db/changeSummary';
import type { BranchRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export type ChangeSummaryState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; summary: ChangeSummary; lineage: ChangeLineage };

/**
 * The change page's own data (Sprint C1 step 6): the branch's own deltas
 * grouped by element, affected capabilities, other open changes touching
 * the same elements, and the delivered/remaining lineage (ADR-006
 * amendment). `branch` is `null` while its own page is still loading —
 * this hook just waits, rather than the caller juggling two loading
 * states.
 */
export function useChangeSummary(modelId: UUID, branch: BranchRow | null): ChangeSummaryState {
  const [state, setState] = useState<ChangeSummaryState>({ status: 'loading' });

  useEffect(() => {
    if (!branch) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });

    Promise.all([loadChangeSummary(supabase, modelId, branch), resolveChangeLineage(supabase, branch)])
      .then(([summary, lineage]) => {
        if (cancelled) return;
        setState({ status: 'ready', summary: summary ?? { subjects: [], affectedCapabilities: [], affectedValueStreams: [], impactProblems: NO_IMPACT_PROBLEMS, otherOpenChanges: [], captureDraftOverlaps: [], sourcesById: new Map(), projectScopeIds: null }, lineage });
      })
      .catch((e: unknown) => {
        reportError("Couldn't load this change's summary.", e);
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load this change.' });
      });

    return () => {
      cancelled = true;
    };
  }, [modelId, branch]);

  return state;
}
