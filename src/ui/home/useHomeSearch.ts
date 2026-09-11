import { useEffect, useState } from 'react';
import type { ElementType, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { hasExactMatch, loadSearchPoolForTypes, matchElements, type SearchPoolElement } from '../../db/elementSearch';
import { enrichElementMatches, type MatchEnrichment } from '../elements/enrichElementMatches';
import { supabase } from '../supabaseClient';

/** Top-level-only element types (ADR-001: `parentId` required non-null for container/component) — the only kinds a home-page search-and-create, with nowhere to pick a parent, can sensibly offer. */
export const HOME_SEARCH_CREATABLE_TYPES: readonly ElementType[] = ['capability', 'system', 'actor'];

export type HomeSearchStatus = 'loading' | 'ready' | 'error';

export interface HomeSearchResultRow {
  element: ElementsHeadRow;
  relationshipCount: number;
  owner: ElementsHeadRow | null;
}

export interface UseHomeSearchResult {
  query: string;
  setQuery: (query: string) => void;
  status: HomeSearchStatus;
  error: string | null;
  results: HomeSearchResultRow[];
  /**
   * Prompt 7h bug fix: true once the pool has loaded, the query is
   * non-empty, and nothing matches it *exactly* — a near-match (any of
   * `results` above) no longer hides this on its own, only an exact one
   * does (`hasExactMatch`, src/db/elementSearch.ts). Always the last row
   * when true (`HomeSearch.tsx`'s own JSX order).
   */
  showCreate: boolean;
}

/**
 * Both front doors' search box (UI-principles §3 + the U3b brief: "search
 * box (search-first) that opens or creates an element") — a multi-type
 * generalisation of `useElementSearchAdd.ts`, searching every top-level-
 * creatable type at once rather than one `ElementSearchAdd` control's own
 * single type. Creation itself (`HomeSearch.tsx`) still asks which of
 * those types once nothing matches — this hook only searches.
 *
 * Handoff — Flow: Add a system, step 2: near-match rows carry owner and
 * relationship count, same enrichment `useElementSearchAdd` already used
 * (`enrichElementMatches.ts`), not a plain type label.
 */
export function useHomeSearch(commitId: UUID, modelId: UUID): UseHomeSearchResult {
  const [pool, setPool] = useState<SearchPoolElement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [enriched, setEnriched] = useState<Map<UUID, MatchEnrichment>>(new Map());

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

  const matches = pool ? matchElements(pool, query) : [];

  useEffect(() => {
    if (matches.length === 0) return undefined;
    let cancelled = false;
    enrichElementMatches(commitId, matches)
      .then((entries) => {
        if (!cancelled) setEnriched(entries);
      })
      .catch(() => {
        // Same tolerance as useElementSearchAdd.ts: enrichment failing
        // shouldn't hide an already-real match.
      });
    return () => {
      cancelled = true;
    };
    // `matches` is a fresh array every render; `pool`/`query` are its real inputs.
  }, [commitId, pool, query]);

  const results: HomeSearchResultRow[] = matches.map((element) => {
    const entry = enriched.get(element.element_id);
    return { element, relationshipCount: entry?.relationshipCount ?? 0, owner: entry?.owner ?? null };
  });

  const status: HomeSearchStatus = error !== null ? 'error' : pool === null ? 'loading' : 'ready';
  // Prompt 7h bug fix: "Create..." is always the last row unless there's
  // an exact, case-insensitive match on a name or alias — a near-match
  // (any of `results` above) never hides it on its own. See
  // src/db/elementSearch.ts's own `hasExactMatch` comment.
  const showCreate = status === 'ready' && query.trim().length > 0 && pool !== null && !hasExactMatch(pool, query);

  return { query, setQuery, status, error, results, showCreate };
}
