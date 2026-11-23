import { useQuery } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { DecisionLinkRow } from '../../db/types';
import { listSupportsEdgesForAllCapabilities } from '../../db/capabilityMap';
import { getElementsByIds } from '../../db/elements';
import { supabase } from '../supabaseClient';
import {
  directlyLinkedCapabilities,
  linkedSupportingSystemIds,
  mergeCapabilityConcerns,
  supportedCapabilityIds,
  type CapabilityConcern,
} from './capabilityConcerns';

/**
 * The capabilities a decision concerns, for the Researcher's safe query chips
 * and the catalogue default. Direct capability links are available on the
 * first render; capabilities reached through a linked system are read from
 * main's `supports` edges in one query. Nothing is inferred from wording.
 */
export function useDecisionCapabilityConcerns(input: {
  commitId: UUID | null;
  links: readonly DecisionLinkRow[];
  linkedElementsById: ReadonlyMap<UUID, ElementsHeadRow>;
  /** Read the extra `supports` edges only when their consumer is on screen. */
  enabled?: boolean;
}): CapabilityConcern[] {
  const direct = directlyLinkedCapabilities(input.links, input.linkedElementsById);
  const systemIds = linkedSupportingSystemIds(input.links, input.linkedElementsById);
  const key = [...systemIds].sort().join(',');

  const { data: supported = [] } = useQuery({
    queryKey: ['decisionCapabilityConcerns', input.commitId, key],
    queryFn: async (): Promise<CapabilityConcern[]> => {
      if (input.commitId === null) return [];
      const edges = await listSupportsEdgesForAllCapabilities(supabase, input.commitId);
      const ids = supportedCapabilityIds(systemIds, edges);
      const missing = ids.filter((id) => !input.linkedElementsById.has(id));
      const fetched = missing.length > 0 ? await getElementsByIds(supabase, input.commitId, missing) : new Map<UUID, ElementsHeadRow>();
      return ids.flatMap((id) => {
        const element = input.linkedElementsById.get(id) ?? fetched.get(id);
        return element?.element_type === 'capability' ? [{ id, name: element.name }] : [];
      });
    },
    enabled: input.enabled !== false && input.commitId !== null && systemIds.length > 0,
    staleTime: 60_000,
  });

  return mergeCapabilityConcerns(direct, supported);
}
