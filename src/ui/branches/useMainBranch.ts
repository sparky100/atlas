import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getMainBranch } from '../../db/branches';
import type { BranchRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
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
 */
export function useMainBranch(modelId: UUID | null): UseMainBranchResult {
  const [branch, setBranch] = useState<BranchRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!modelId) {
      setBranch(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getMainBranch(supabase, modelId)
      .then((row) => {
        if (!cancelled) setBranch(row);
      })
      .catch((e: unknown) => {
        if (!cancelled) setBranch(null);
        // Sprint U4-2a item 2: this used to swallow the failure entirely —
        // `branch` just stays `null`, indistinguishable from "this model
        // has no main branch yet" (which can't actually happen, ADR-018,
        // but the type never said so). Every caller of this hook reads
        // `main.head_commit_id` for something real (search, canAdd,
        // canEdit) — silently disabling all of that with no visible cause
        // is worse than a banner naming what failed.
        reportError(e instanceof Error ? `Couldn't load this model's main: ${e.message}` : "Couldn't load this model's main.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, reloadToken]);

  return {
    branch,
    loading,
    reload: () => {
      setReloadToken((t) => t + 1);
    },
  };
}
