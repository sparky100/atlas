import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getThreadCounts } from '../../db/comments';
import { supabase } from '../supabaseClient';

export interface ThreadCount {
  open: number;
  total: number;
}

export type UseThreadCountsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; counts: ReadonlyMap<UUID, ThreadCount> };

/**
 * Batched thread counts for a set of anchors — the landscape canvas's own
 * marker source (Sprint M1b, `docs/HANDOFF-M1b-comments.md`'s Canvas
 * section: "Counts come from `atlas.unresolved_comment_counts`... do not
 * compute it client-side from a full thread list"), now also the
 * capability map's own marker and the element browse table's unresolved
 * column (M1 close-out items 2/4). One POST RPC per `anchorIds` change,
 * not per node/tile/row — `getThreadCounts` is exactly rule 8's
 * POST-not-`.in()` shape.
 *
 * Renamed from `useUnresolvedCommentCounts` (M1 close-out item 1): every
 * caller of that hook only ever read the open count anyway, and the new
 * `{ open, total }` shape is what lets a marker tell "no comments" apart
 * from "every thread resolved" — `counts.get(id)` is `undefined` for the
 * former, `{ open: 0, total: n > 0 }` for the latter.
 *
 * Scoped to every anchor currently loaded on the page, not re-fetched per
 * pan/zoom — the handoff's "one POST RPC per viewport" is a further
 * optimisation this doesn't yet make; correctness doesn't depend on it;
 * it's a possible follow-up if a very large landscape makes the one-shot
 * fetch itself slow.
 */
export function useThreadCounts(modelId: UUID | null, anchorIds: readonly UUID[]): UseThreadCountsState {
  const [state, setState] = useState<UseThreadCountsState>({ status: 'loading' });
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
    getThreadCounts(supabase, modelId, anchorIds)
      .then((rows) => {
        if (cancelled) return;
        setState({ status: 'ready', counts: new Map(rows.map((r) => [r.anchor_id, { open: r.open_count, total: r.total_count }])) });
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
