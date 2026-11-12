import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { countMatches, loadSearchPoolForTypes, matchElements, overlayBranchElements, type SearchPoolElement } from '../../db/elementSearch';
import { enrichElementMatches, type MatchEnrichment } from '../elements/enrichElementMatches';
import { loadProjectionAtCommitCached } from '../query/cachedBranchProjection';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { HOME_SEARCH_TYPES, hasCreatableExactMatch, sameNameModules, type SameNameModule } from './homeSearchTypes';

export type HomeSearchStatus = 'loading' | 'ready' | 'error';

export interface HomeSearchResultRow {
  element: ElementsHeadRow;
  relationshipCount: number;
  owner: ElementsHeadRow | null;
  /** A container's own parent platform/system, for disambiguating a short, commonly-reused module name — `null` for every other type (`enrichElementMatches.ts`'s own `parent` field). */
  parent: ElementsHeadRow | null;
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
  /** How many more real matches exist beyond `results` (`countMatches` minus what's shown) — `HomeSearch.tsx` renders this so a short/empty `results` list reads as "keep typing to narrow," not "safe to create" (a near-match past the display cap never suppresses `showCreate` on its own — only an exact match does). 0 when nothing was cut off. */
  moreCount: number;
  /** Modules with exactly the typed name (or alias) — drawn from the whole pool, not the capped `results`, so one can never be missed. */
  sameNameModules: SameNameModule[];
}

/**
 * Both front doors' search box (UI-principles §3 + the U3b brief: "search
 * box (search-first) that opens or creates an element") — a multi-type
 * generalisation of `useElementSearchAdd.ts`, searching every
 * `HOME_SEARCH_TYPES` type at once rather than one `ElementSearchAdd`
 * control's own single type. Creation itself (`HomeSearch.tsx`) still asks
 * which of `HOME_SEARCH_CREATABLE_TYPES` once nothing matches — a strict
 * subset of what's searched, since a container has nowhere to pick a
 * parent from Home but is still a real element worth finding by name.
 *
 * Handoff — Flow: Add a system, step 2: near-match rows carry owner and
 * relationship count, same enrichment `useElementSearchAdd` already used
 * (`enrichElementMatches.ts`), not a plain type label.
 */
/**
 * `branchCommitId`: the front door's own active change branch, when
 * there is one (`HomeSearch.tsx`'s own `activeRef`/`editingBranch`) — folded
 * and overlaid onto the main-scoped pool (`overlayBranchElements`) so an
 * element added or edited earlier in *this* change is findable again
 * without waiting for a merge, the one deliberate exception
 * `src/db/elementSearch.ts`'s own module comment names. `null` (viewing
 * main, or no branch context) keeps this exactly as main-only as before.
 */
export function useHomeSearch(commitId: UUID, modelId: UUID, branchCommitId: UUID | null = null): UseHomeSearchResult {
  const [pool, setPool] = useState<SearchPoolElement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [enriched, setEnriched] = useState<Map<UUID, MatchEnrichment>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setPool(null);
    setError(null);
    Promise.all([
      loadSearchPoolForTypes(supabase, commitId, modelId, HOME_SEARCH_TYPES),
      branchCommitId !== null ? loadProjectionAtCommitCached(supabase, modelId, branchCommitId) : Promise.resolve(null),
    ])
      .then(([mainPool, branchProjection]) => {
        if (cancelled) return;
        setPool(branchProjection !== null ? overlayBranchElements(mainPool, branchProjection.elementsHead, HOME_SEARCH_TYPES) : mainPool);
      })
      .catch((e: unknown) => {
        // S1 audit follow-up (item 15's own reportError rollout missed this one).
        reportError("Couldn't load existing elements to search against.", e);
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load existing elements to search against.');
      });
    return () => {
      cancelled = true;
    };
  }, [commitId, modelId, branchCommitId]);

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
    return { element, relationshipCount: entry?.relationshipCount ?? 0, owner: entry?.owner ?? null, parent: entry?.parent ?? null };
  });

  const status: HomeSearchStatus = error !== null ? 'error' : pool === null ? 'loading' : 'ready';
  // Prompt 7h bug fix: "Create..." is always the last row unless there's
  // an exact, case-insensitive match on a name or alias — a near-match
  // (any of `results` above) never hides it on its own. See
  // src/db/elementSearch.ts's own `hasExactMatch` comment. Restricted to
  // `HOME_SEARCH_CREATABLE_TYPES` (`homeSearchTypes.ts`'s own
  // `hasCreatableExactMatch`): a container was added to search but never
  // to what this control can
  // create, so an exact hit on a module's own name must not suppress
  // creating a same-named top-level capability/system/actor — the two are
  // legitimately different things, and a container was never a candidate
  // this "Create..." row offers in the first place.
  const showCreate = status === 'ready' && query.trim().length > 0 && pool !== null && !hasCreatableExactMatch(pool, query);
  const totalMatches = pool ? countMatches(pool, query) : 0;

  return { query, setQuery, status, error, results, showCreate, moreCount: Math.max(0, totalMatches - matches.length), sameNameModules: pool ? sameNameModules(pool, query) : [] };
}
