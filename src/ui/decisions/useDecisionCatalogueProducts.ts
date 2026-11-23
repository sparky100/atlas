import { useQuery } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { DecisionLinkRow } from '../../db/types';
import { currentCatalogueEntriesForCapabilityElement } from '../../db/productCatalogue';
import { supabase } from '../supabaseClient';
import { directlyLinkedCapabilities } from './capabilityConcerns';
import { mergeKnownCatalogueProducts, type KnownCatalogueProduct } from './researchCatalogueMatches';

/**
 * Current reviewed products for the capabilities a decision directly concerns.
 * Only read while the Researcher is open: it lets a returned web page be
 * marked as a product the catalogue already holds, without asking a model to
 * guess and without inventing a match. Capabilities reached through a linked
 * system are not included yet; the saved catalogue sources on the decision
 * still cover those.
 */
export function useDecisionCatalogueProducts(input: {
  enabled: boolean;
  modelId: UUID;
  links: readonly DecisionLinkRow[];
  linkedElementsById: ReadonlyMap<UUID, ElementsHeadRow>;
}): KnownCatalogueProduct[] {
  const capabilities = directlyLinkedCapabilities(input.links, input.linkedElementsById);
  const key = capabilities.map((capability) => capability.id).sort().join(',');

  const { data = [] } = useQuery({
    queryKey: ['decisionCatalogueProducts', input.modelId, key],
    queryFn: async (): Promise<KnownCatalogueProduct[]> => {
      const groups = await Promise.all(capabilities.map(async (capability): Promise<KnownCatalogueProduct[]> => {
        const element = input.linkedElementsById.get(capability.id);
        if (element === undefined) return [];
        const entries = await currentCatalogueEntriesForCapabilityElement(supabase, input.modelId, element.attributes);
        return entries.map((entry) => ({
          product: entry.product,
          vendor: entry.vendor,
          sourceUrls: entry.claims.map((claim) => claim.sourceUrl),
        }));
      }));
      return mergeKnownCatalogueProducts(...groups);
    },
    enabled: input.enabled && key !== '',
    staleTime: 60_000,
  });

  return data;
}
