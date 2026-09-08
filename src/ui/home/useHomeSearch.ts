import { useEffect, useState } from 'react';
import type { ElementType, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { loadSearchPoolForTypes, matchElements, type SearchPoolElement } from '../../db/elementSearch';
import { supabase } from '../supabaseClient';

/** Top-level-only element types (ADR-001: `parentId` required non-null for container/component) — the only kinds a home-page search-and-create, with nowhere to pick a parent, can sensibly offer. */
export const HOME_SEARCH_CREATABLE_TYPES: readonly ElementType[] = ['capability', 'system', 'actor'];

export type HomeSearchStatus = 'loading' | 'ready' | 'error';

export interface UseHomeSearchResult {
  query: string;
  setQuery: (query: string) => void;
  status: HomeSearchStatus;
  error: string | null;
  results: ElementsHeadRow[];
  showCreate: boolean;
}

/**
 * Both front doors' search box (UI-principles §3 + the U3b brief: "search
 * box (search-first) that opens or creates an element") — a multi-type
 * generalisation of `useElementSearchAdd.ts`, searching every top-level-
 * creatable type at once rather than one `ElementSearchAdd` control's own
 * single type. Creation itself (`HomeSearch.tsx`) still asks which of
 * those types once nothing matches — this hook only searches.
 */
export function useHomeSearch(commitId: UUID, modelId: UUID): UseHomeSearchResult {
  const [pool, setPool] = useState<SearchPoolElement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setPool(null);
    setError(null);
    loadSearchPoolForTypes(supabase, commitId, modelId, HOME_SEARCH_CREATABLE_TYPES)
      .then((loaded) => {
        if (!cancelled) setPool(loaded);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load existing elements to search against.');
      });
    return () => {
      cancelled = true;
    };
  }, [commitId, modelId]);

  const results = pool ? matchElements(pool, query) : [];
  const status: HomeSearchStatus = error !== null ? 'error' : pool === null ? 'loading' : 'ready';
  const showCreate = status === 'ready' && query.trim().length > 0 && results.length === 0;

  return { query, setQuery, status, error, results, showCreate };
}
