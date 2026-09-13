import { useEffect, useState } from 'react';
import type { ElementType, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { loadSearchPoolForTypes, matchElements, type SearchPoolElement } from '../../db/elementSearch';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export type RelationshipTargetSearchStatus = 'loading' | 'ready' | 'error';

export interface UseRelationshipTargetSearchResult {
  query: string;
  setQuery: (query: string) => void;
  status: RelationshipTargetSearchStatus;
  error: string | null;
  results: ElementsHeadRow[];
}

/**
 * The relationship "+ Add" picker's search (Blocking: element creation,
 * per the user's own clarification: "a search-first picker for the other
 * endpoint, restricted to the allowed target types"). Unlike
 * `useElementSearchAdd`, this never offers a "Create …" fallback — picking
 * an endpoint for a relationship is choosing between elements that already
 * exist, not adding a new one — and excludes `excludeElementId` (the
 * element whose Relationships section this control lives on: relating an
 * element to itself is never legal, C9/relationship_type_rules has no self
 * triple).
 *
 * `enabled` (Prompt 7k item 4): `RelationshipAdd.tsx` needs a *second*
 * instance of this hook for the `via` stage's own platform search — but
 * only for `uses`/`flows_to` slots, never `supports`/`owns`. Since hooks
 * can't be called conditionally, this flag lets an unneeded instance skip
 * its own fetch entirely, so every other relationship-type slot on the
 * same element page doesn't mount a redundant system-pool query. Defaults
 * to `true`; every existing caller is unaffected.
 */
export function useRelationshipTargetSearch(commitId: UUID, modelId: UUID, targetTypes: readonly ElementType[], excludeElementId: UUID, enabled = true): UseRelationshipTargetSearchResult {
  const [pool, setPool] = useState<SearchPoolElement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const typesKey = targetTypes.join(',');

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setPool(null);
    setError(null);
    loadSearchPoolForTypes(supabase, commitId, modelId, targetTypes)
      .then((loaded) => {
        if (!cancelled) setPool(loaded);
      })
      .catch((e: unknown) => {
        // S1 audit follow-up (item 15's own reportError rollout missed this one).
        reportError("Couldn't load existing elements to search against.", e);
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load existing elements to search against.');
      });
    return () => {
      cancelled = true;
    };
    // `typesKey` stands in for `targetTypes`, a fresh array every render.
  }, [commitId, modelId, typesKey, enabled]);

  const matches = pool ? matchElements(pool, query).filter((element) => element.element_id !== excludeElementId) : [];
  const status: RelationshipTargetSearchStatus = error !== null ? 'error' : pool === null ? 'loading' : 'ready';

  return { query, setQuery, status, error, results: matches };
}
