import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getMainBranch } from '../../db/branches';
import { findBoundaryCrossings, listAllUsesAndFlowsToEdges, listUsesAndFlowsToEndpointElements, type BoundaryCrossing } from '../../db/healthFindings';
import { supabase } from '../supabaseClient';

export type BoundaryCrossingsState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; crossings: BoundaryCrossing[] };

/**
 * Prompt 7k item 3's "Boundary crossings" list (`/boundary-crossings`,
 * reachable from the architect door) — every `uses`/`flows_to` edge whose
 * two endpoints resolve to opposite sides of the IT/OT boundary, at
 * main's current head. Same "one commit-scoped query, findBoundaryCrossings
 * does the rest" shape `useArchitectHome.ts`'s own boundary-crossing data
 * already uses, factored out here so this page doesn't need the whole
 * architect-door payload just to show this one list.
 */
export function useBoundaryCrossings(modelId: UUID): BoundaryCrossingsState {
  const [state, setState] = useState<BoundaryCrossingsState>({ status: 'loading' });

  useEffect(() => {
    if (!modelId) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      const main = await getMainBranch(supabase, modelId);
      if (!main) {
        if (!cancelled) setState({ status: 'error', message: 'This model has no main yet.' });
        return;
      }
      const [edges, elements] = await Promise.all([listAllUsesAndFlowsToEdges(supabase, main.head_commit_id), listUsesAndFlowsToEndpointElements(supabase, main.head_commit_id)]);
      const elementsById = new Map(elements.map((e) => [e.element_id, e]));
      if (!cancelled) setState({ status: 'ready', crossings: findBoundaryCrossings(edges, elementsById) });
    }

    load().catch((e: unknown) => {
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load boundary crossings.' });
    });
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  return state;
}
