import { useEffect, useState } from 'react';
import type { ElementType, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { loadSearchPool, matchElements, type SearchPoolElement } from '../../db/elementSearch';
import { enrichElementMatches, type MatchEnrichment } from './enrichElementMatches';
import { supabase } from '../supabaseClient';

export interface SearchResultRow {
  element: ElementsHeadRow;
  relationshipCount: number;
  /** The `owns` relationship's primary actor into this element, if any (only ever populated for a `system`, per `RELATIONSHIP_TYPE_RULES` — null for every other type, not specially cased). */
  owner: ElementsHeadRow | null;
}

export type ElementSearchStatus = 'loading' | 'ready' | 'error';

export interface UseElementSearchAddResult {
  query: string;
  setQuery: (query: string) => void;
  status: ElementSearchStatus;
  error: string | null;
  results: SearchResultRow[];
  /** Blocking: element creation's "'Create <type>' appears only when nothing matches" — true once the pool has loaded, the query is non-empty, and it matched nothing. */
  showCreate: boolean;
}

/**
 * Drives the search-first "Add" control (Blocking: element creation):
 * loads `elementType`'s search pool once for `commitId` (src/db/
 * elementSearch.ts), matches it against `query` on every keystroke (cheap —
 * an in-memory pass over an already-loaded pool, not a request), then
 * enriches only the shown matches (never the whole pool) with a
 * relationship count and primary owner, one request per match — the same
 * per-row batching shape `getElementsByIds` exists for elsewhere, sized to
 * the typeahead's own small result list rather than the model.
 */
export function useElementSearchAdd(commitId: UUID, modelId: UUID, elementType: ElementType): UseElementSearchAddResult {
  const [pool, setPool] = useState<SearchPoolElement[] | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [enriched, setEnriched] = useState<Map<UUID, MatchEnrichment>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setPool(null);
    setPoolError(null);
    loadSearchPool(supabase, commitId, modelId, elementType)
      .then((loaded) => {
        if (!cancelled) setPool(loaded);
      })
      .catch((e: unknown) => {
        if (!cancelled) setPoolError(e instanceof Error ? e.message : 'Could not load existing elements to search against.');
      });
    return () => {
      cancelled = true;
    };
  }, [commitId, modelId, elementType]);

  const matches = pool ? matchElements(pool, query) : [];

  useEffect(() => {
    if (matches.length === 0) return undefined;
    let cancelled = false;
    enrichElementMatches(commitId, matches)
      .then((entries) => {
        if (!cancelled) setEnriched(entries);
      })
      .catch(() => {
        // Enrichment (relationship count, owner) is a nice-to-have on top of
        // an already-real match — a failure here shouldn't hide the match
        // itself, so this silently leaves those rows at their zero/null
        // defaults rather than surfacing a second error state.
      });
    return () => {
      cancelled = true;
    };
    // `pool`/`query` are matches' real inputs; `matches` itself is a fresh
    // array every render and would re-run this on every keystroke's render
    // even when the actual match set hasn't changed.
  }, [commitId, pool, query]);

  const results: SearchResultRow[] = matches.map((element) => {
    const entry = enriched.get(element.element_id);
    return { element, relationshipCount: entry?.relationshipCount ?? 0, owner: entry?.owner ?? null };
  });

  const status: ElementSearchStatus = poolError !== null ? 'error' : pool === null ? 'loading' : 'ready';
  const showCreate = status === 'ready' && query.trim().length > 0 && results.length === 0;

  return { query, setQuery, status, error: poolError, results, showCreate };
}
