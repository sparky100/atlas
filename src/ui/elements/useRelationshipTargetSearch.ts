import { useEffect, useState } from 'react';
import type { ElementType, UUID } from '../../contracts/delta';
import { SYSTEM_LIKE_TYPES } from '../../contracts/elementKinds';
import type { ElementsHeadRow } from '../../contracts/rows';
import { countMatches, loadSearchPoolForTypes, matchElements, overlayBranchElements, type SearchPoolElement } from '../../db/elementSearch';
import { getElementsByIds } from '../../db/elements';
import { loadProjectionAtCommitCached } from '../query/cachedBranchProjection';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

/** "An application" for every picker that asks the user to find one: a system, or a module inside a platform (shown "Platform · Module" via `resultParents`). Use this rather than `['system']`, so no picker quietly misses modules. */
export const SYSTEM_OR_MODULE_TYPES: readonly ElementType[] = SYSTEM_LIKE_TYPES;

export type RelationshipTargetSearchStatus = 'loading' | 'ready' | 'error';

export interface UseRelationshipTargetSearchResult {
  query: string;
  setQuery: (query: string) => void;
  status: RelationshipTargetSearchStatus;
  error: string | null;
  results: ElementsHeadRow[];
  /** How many more real matches exist beyond `results` (`countMatches` minus what's shown) — a caller renders this so an empty or short `results` list reads as "keep typing to narrow," never "this doesn't exist." 0 when nothing was cut off. */
  moreCount: number;
  /** Every container result's own parent, keyed by the container's own `element_id` — resolved once per pool load (every distinct parent among the *whole* pool, not just the currently-shown page of results), so `moduleDisplayName(result, resultParents.get(result.element_id) ?? null)` renders "Platform · Module" the same way every other surface that can show a container does. Empty when `targetTypes` never includes `container` at all, or a parent lookup fails (best-effort — same "a display enrichment failing shouldn't hide the match itself" stance `enrichElementMatches.ts` takes). */
  resultParents: ReadonlyMap<UUID, ElementsHeadRow>;
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
 *
 * `branchCommitId`: the change branch being written to, when there is one
 * (every real caller already has this in hand as its own `branch` prop —
 * `null` for main itself, or when the caller has no branch context of its
 * own). When given, this branch's own head is folded (cached — the same
 * `loadProjectionAtCommitCached` `useLandscape.ts` already uses to render a
 * branch's own content) and overlaid onto the main-scoped pool
 * (`overlayBranchElements`), so an element added or edited earlier in the
 * *same* change is findable here without waiting for a merge — closing the
 * gap `src/db/elementSearch.ts`'s own module comment names (real capture
 * review: retiring "SAP BW" with "SAP Datasphere," added moments earlier
 * on the same change, as its replacement — the "replaced by" picker found
 * nothing at all, because it only ever searched main). Omit it (or pass
 * `null`) to keep this hook exactly as main-only as it's always been.
 */
export function useRelationshipTargetSearch(
  commitId: UUID,
  modelId: UUID,
  targetTypes: readonly ElementType[],
  excludeElementId: UUID,
  enabled = true,
  branchCommitId: UUID | null = null,
): UseRelationshipTargetSearchResult {
  const [pool, setPool] = useState<SearchPoolElement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [resultParents, setResultParents] = useState<Map<UUID, ElementsHeadRow>>(new Map());
  const typesKey = targetTypes.join(',');

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setPool(null);
    setError(null);
    setResultParents(new Map());
    Promise.all([
      loadSearchPoolForTypes(supabase, commitId, modelId, targetTypes),
      branchCommitId !== null ? loadProjectionAtCommitCached(supabase, modelId, branchCommitId) : Promise.resolve(null),
    ])
      .then(([mainPool, branchProjection]) => {
        if (cancelled) return;
        const loaded = branchProjection !== null ? overlayBranchElements(mainPool, branchProjection.elementsHead, targetTypes) : mainPool;
        setPool(loaded);
        // A branch-sourced element's own id map, so a container added on
        // the same branch as its own parent platform can still resolve one
        // — `getElementsByIds` below only ever reads main, which has never
        // heard of either.
        const branchElementsById = branchProjection !== null ? new Map(branchProjection.elementsHead.map((element) => [element.element_id, element])) : null;
        // Resolved once per pool load, for every container in the whole
        // pool — not re-fetched per keystroke, and not scoped to whatever
        // page of results a given query happens to show.
        const containersWithParent = loaded.filter((p): p is SearchPoolElement & { element: ElementsHeadRow & { parent_id: UUID } } => p.element.element_type === 'container' && p.element.parent_id !== null);
        const containerParentIds = [...new Set(containersWithParent.map((p) => p.element.parent_id))];
        if (containerParentIds.length === 0) return;
        getElementsByIds(supabase, commitId, containerParentIds)
          .then((parentsById) => {
            if (cancelled) return;
            const byContainerId = new Map<UUID, ElementsHeadRow>();
            for (const { element } of loaded) {
              if (element.element_type !== 'container' || element.parent_id === null) continue;
              const parent = parentsById.get(element.parent_id) ?? branchElementsById?.get(element.parent_id);
              if (parent) byContainerId.set(element.element_id, parent);
            }
            setResultParents(byContainerId);
          })
          .catch(() => {
            // Best-effort, same stance `enrichElementMatches.ts` takes: a
            // display enrichment failing shouldn't hide the match itself,
            // so this silently leaves every module's name bare rather than
            // surfacing a second error state.
          });
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
  }, [commitId, modelId, typesKey, enabled, branchCommitId]);

  // Excluding `excludeElementId` inside `matchElements`/`countMatches`
  // themselves (rather than filtering the already-capped result afterward)
  // means a query that matches this element too still backfills the
  // display from the next-best real candidate, instead of just showing one
  // fewer result than the cap allows.
  const matches = pool ? matchElements(pool, query, 8, excludeElementId) : [];
  const totalMatches = pool ? countMatches(pool, query, excludeElementId) : 0;
  const status: RelationshipTargetSearchStatus = error !== null ? 'error' : pool === null ? 'loading' : 'ready';

  return { query, setQuery, status, error, results: matches, moreCount: Math.max(0, totalMatches - matches.length), resultParents };
}
