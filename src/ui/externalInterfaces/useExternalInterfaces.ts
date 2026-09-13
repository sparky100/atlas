import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getMainBranch } from '../../db/branches';
import { findExternalInterfacesMissingClassification, findExternalOrganisationAccess, listAllUsesAndFlowsToEdges, listUsesAndFlowsToEndpointElements, type ExternalInterfaceCrossing, type ExternalOrganisationAccess } from '../../db/healthFindings';
import { listActorsForLandscape } from '../../db/landscape';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export type ExternalInterfacesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; crossings: ExternalInterfaceCrossing[]; organisationAccess: ExternalOrganisationAccess[] };

/**
 * S1 item 11a's "View all →" target for both new Assurance rows
 * (`ArchitectHome.tsx`'s own `assuranceChecks`): every `uses`/`flows_to`
 * edge crossing the enterprise/external boundary with no data
 * classification, and every external actor's own `uses` access — not just
 * the ones a health finding flags, the same "the full honest list, the
 * health finding is the narrower subset" relationship `useBoundaryCrossings.ts`
 * already has with `BoundaryCrossingsView.tsx`. One page for both rows
 * (`ExternalInterfacesView.tsx`) rather than two near-identical ones: they
 * share the same query and the same "external boundary" theme, just two
 * different questions about it (a metadata gap vs. plain visibility).
 */
export function useExternalInterfaces(modelId: UUID): ExternalInterfacesState {
  const [state, setState] = useState<ExternalInterfacesState>({ status: 'loading' });

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
      const [edges, elements, actors] = await Promise.all([
        listAllUsesAndFlowsToEdges(supabase, main.head_commit_id),
        listUsesAndFlowsToEndpointElements(supabase, main.head_commit_id),
        listActorsForLandscape(supabase, main.head_commit_id),
      ]);
      const elementsById = new Map([...elements, ...actors].map((e) => [e.element_id, e]));
      if (!cancelled) {
        setState({
          status: 'ready',
          crossings: findExternalInterfacesMissingClassification(edges, elementsById),
          organisationAccess: findExternalOrganisationAccess(edges, elementsById),
        });
      }
    }

    load().catch((e: unknown) => {
      reportError("Couldn't load external interfaces.", e);
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load external interfaces.' });
    });
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  return state;
}
