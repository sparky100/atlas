import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getUnresolvedCommentCounts } from '../../db/comments';
import { supabase } from '../supabaseClient';

export type UseUnresolvedCommentCountsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; counts: ReadonlyMap<UUID, number> };

/**
 * Batched unresolved-thread counts for a set of anchors — the landscape
 * canvas's own marker source (Sprint M1b, `docs/HANDOFF-M1b-comments.md`'s
 * Canvas section: "Counts come from `atlas.unresolved_comment_counts`... do
 * not compute it client-side from a full thread list"). One POST RPC per
 * `anchorIds` change, not per node — `getUnresolvedCommentCounts` already
 * exists (Sprint M1a backend) and is exactly rule 8's POST-not-`.in()`
 * shape.
 *
 * Scoped to every system currently loaded on the page (`systemsById`'s own
 * keys), not re-fetched per pan/zoom — the handoff's "one POST RPC per
 * viewport" is a further optimisation this doesn't yet make; correctness
 * doesn't depend on it; it's a possible follow-up if a very large landscape
 * makes the one-shot fetch itself slow.
 */
export function useUnresolvedCommentCounts(modelId: UUID | null, anchorIds: readonly UUID[]): UseUnresolvedCommentCountsState {
  const [state, setState] = useState<UseUnresolvedCommentCountsState>({ status: 'loading' });
  // Stable dependency key — `anchorIds` is typically a fresh array each
  // render (derived from a Map's keys), which would otherwise re-fetch every
  // render even when the underlying id set hasn't changed.
  const key = [...anchorIds].sort().join(',');

  useEffect(() => {
    if (!modelId || anchorIds.length === 0) {
      setState({ status: 'ready', counts: new Map() });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    getUnresolvedCommentCounts(supabase, modelId, anchorIds)
      .then((rows) => {
        if (cancelled) return;
        setState({ status: 'ready', counts: new Map(rows.map((r) => [r.anchor_id, r.unresolved_count])) });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Could not load comment counts.' });
      });
    return () => {
      cancelled = true;
    };
    // `key` (not `anchorIds`) is the real dependency here — see this
    // hook's own module comment; hooks living in a plain `.ts` file aren't
    // covered by `react-hooks/exhaustive-deps` (eslint.config.js scopes
    // the react-hooks plugin to `src/ui/**/*.tsx` only), so there's no
    // rule to disable.
  }, [modelId, key]);

  return state;
}
