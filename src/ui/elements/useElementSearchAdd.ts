import { useEffect, useState } from 'react';
import type { ElementType, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { countMatches, hasExactMatch, loadSearchPool, matchElements, type SearchPoolElement } from '../../db/elementSearch';
import { enrichElementMatches, type MatchEnrichment } from './enrichElementMatches';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface SearchResultRow {
  element: ElementsHeadRow;
  relationshipCount: number;
  /** The `owns` relationship's primary actor into this element, if any (populated for a `system` or `container`, per `RELATIONSHIP_TYPE_RULES` — null for every other type, not specially cased). */
  owner: ElementsHeadRow | null;
}

export type ElementSearchStatus = 'loading' | 'ready' | 'error';

export interface UseElementSearchAddResult {
  query: string;
  setQuery: (query: string) => void;
  status: ElementSearchStatus;
  error: string | null;
  results: SearchResultRow[];
  /**
   * Prompt 7h bug fix (was: Blocking: element creation's "'Create <type>'
   * appears only when nothing matches"): true once the pool has loaded,
   * the query is non-empty, and nothing matches it *exactly* — a
   * near-match no longer hides this on its own, only an exact one does
   * (`hasExactMatch`, src/db/elementSearch.ts).
   */
  showCreate: boolean;
  /** How many more real matches exist beyond `results` (`countMatches` minus what's shown) — rendered so a short/empty `results` list reads as "keep typing to narrow," not "safe to create" (a near-match past the display cap never suppresses `showCreate` on its own — only an exact match does). 0 when nothing was cut off. */
  moreCount: number;
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
        // S1 audit follow-up (item 15's own reportError rollout missed this
        // one) — the enrichment catch below stays silent on purpose (its
        // own comment), but a failure to load the search pool at all is a
        // real load failure.
        reportError("Couldn't load existing elements to search against.", e);
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
  // Prompt 7h bug fix: "Create..." is always the last row unless there's
  // an exact, case-insensitive match on a name or alias — a near-match
  // (any of `results` above) never hides it on its own. See
  // src/db/elementSearch.ts's own `hasExactMatch` comment.
  const showCreate = status === 'ready' && query.trim().length > 0 && pool !== null && !hasExactMatch(pool, query);
  const totalMatches = pool ? countMatches(pool, query) : 0;

  return { query, setQuery, status, error: poolError, results, showCreate, moreCount: Math.max(0, totalMatches - matches.length) };
}
