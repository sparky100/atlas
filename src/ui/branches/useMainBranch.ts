import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import { getMainBranch } from '../../db/branches';
import type { Ref } from '../../db/ref';
import type { BranchRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { invalidateModelHead } from '../query/invalidateModelHead';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

export interface UseMainBranchResult {
  branch: BranchRow | null;
  loading: boolean;
  /**
   * Re-fetches this row (Sprint U4-1 A1) — call after any commit that may
   * have moved `main`'s head, alongside whatever else the page reloads.
   * Needed because `head_commit_id` isn't just a display value: every
   * search-pool hook (`useElementSearchAdd`/`useHomeSearch`/
   * `useRelationshipTargetSearch`) reads `elements_head`/`aliases` filtered
   * to a specific `commit_id`, and `elements_head` only ever holds rows for
   * `main`'s *current* head (SPEC §1 S-2/P-6) — once another commit lands,
   * the old `commit_id` this hook handed out has zero rows left, not just
   * stale ones. Without calling this, a page that creates something once
   * and then searches again (or creates a second thing) silently searches
   * against a `commit_id` that no longer exists, finding nothing at all.
   */
  reload: () => void;
}

/**
 * A model's `main` branch row (Sprint C1 step 4) — every editing hook now
 * takes an explicit `branch: BranchRow` rather than looking `main` up for
 * itself (src/ui/elements/useElementEditor.ts's own doc comment), so every
 * page that edits at `main` needs this once. `id`/`kind` never change once
 * a model exists, but `head_commit_id` does, on every commit — `reload`
 * (added Sprint U4-1 A1) is how a caller keeps it current; see `reload`'s
 * own doc comment for why that matters beyond "the value looks stale."
 *
 * E8 item (1): backed by the shared `QueryClient` now (`src/ui/query/`) —
 * `reload()` calls `invalidateModelHead`, which invalidates this exact
 * query key, so *every* mounted component reading this model's main
 * branch (not just the one that called `reload`) refetches, not only the
 * caller's own local state. This is the real behavioural fix E8 item (1)
 * is after: previously each page's own `useMainBranch(modelId)` call held
 * fully independent state, so calling `reload()` from, say, ElementPage
 * never refreshed CapabilityMapPage's own copy even if both were
 * conceptually showing "the same model's main branch."
 */
export function useMainBranch(modelId: UUID | null): UseMainBranchResult {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.mainBranch(modelId),
    queryFn: async () => {
      if (!modelId) return null;
      try {
        return await getMainBranch(supabase, modelId);
      } catch (e) {
        // Sprint U4-2a item 2: this used to swallow the failure entirely —
        // `branch` just stays `null`, indistinguishable from "this model
        // has no main branch yet" (which can't actually happen, ADR-018,
        // but the type never said so). Every caller of this hook reads
        // `main.head_commit_id` for something real (search, canAdd,
        // canEdit) — silently disabling all of that with no visible cause
        // is worse than a banner naming what failed.
        reportError("Couldn't load this model's main.", e);
        return null;
      }
    },
    enabled: modelId !== null,
  });

  return {
    branch: data ?? null,
    loading: isLoading,
    reload: () => {
      if (modelId) void invalidateModelHead(queryClient, modelId);
    },
  };
}

/**
 * Performance: the model id a page should hand its main-scoped data hook —
 * `null` while `main` itself is still loading *and* the page is viewing
 * `main`, so the hook's own "no model id yet" guard holds it back and it
 * loads once, with `head_commit_id` as its hint, instead of loading once
 * without the hint and again the moment `main` arrives (every request of
 * the page sent twice — seen on the element page's waterfall). Any other
 * ref never waits: it doesn't use the hint.
 */
export function hintedModelId(modelId: UUID | null | undefined, ref: Ref, mainLoading: boolean): UUID | null {
  if (!modelId) return null;
  return ref.kind === 'main' && mainLoading ? null : modelId;
}
