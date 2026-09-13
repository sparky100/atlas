import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { compareDecisionOptions, type CompareDecisionOptionsResult } from './compareOptions';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface DecisionComparisonOption {
  branchId: UUID;
  headCommitId: UUID;
  label: string;
}

export type DecisionComparisonState = { status: 'empty' } | { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & CompareDecisionOptionsResult);

/**
 * F3 PR5's comparison table data — recomputed whenever the decision's own
 * concerned capabilities or option branches change (keyed by their own
 * ids, the same "join into one dependency-array key" pattern
 * `useRelationshipTargetSearch.ts`'s own `typesKey` already uses for an
 * array prop). `'empty'` (no options yet) is distinct from `'loading'` so
 * the decision page can render "add an option to compare" without a
 * flash of a loading spinner that never resolves to anything.
 */
export function useDecisionComparison(modelId: UUID, mainHeadCommitId: UUID | null, capabilityIds: readonly UUID[], options: readonly DecisionComparisonOption[]): DecisionComparisonState {
  const [state, setState] = useState<DecisionComparisonState>({ status: 'empty' });
  const capabilityIdsKey = capabilityIds.join(',');
  const optionsKey = options.map((o) => `${o.branchId}:${o.headCommitId}`).join(',');

  useEffect(() => {
    if (!mainHeadCommitId || options.length === 0) {
      setState({ status: 'empty' });
      return undefined;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    compareDecisionOptions(supabase, { modelId, mainHeadCommitId, capabilityIds, options })
      .then((result) => {
        if (!cancelled) setState({ status: 'ready', ...result });
      })
      .catch((e: unknown) => {
        reportError("Couldn't compare this decision's options.", e);
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : "Could not compare this decision's options." });
      });
    return () => {
      cancelled = true;
    };
    // capabilityIdsKey/optionsKey stand in for capabilityIds/options, fresh arrays every render.
  }, [modelId, mainHeadCommitId, capabilityIdsKey, optionsKey]);

  return state;
}
