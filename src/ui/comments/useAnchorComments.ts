import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { listBranchesByIds } from '../../db/branches';
import { listCommentsForAnchor, type AnchorComments } from '../../db/comments';
import { listProfilesByIds } from '../../db/profiles';
import type { AnchorType, BranchRow, ProfileRow } from '../../db/types';
import { supabase } from '../supabaseClient';

export type UseAnchorCommentsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: AnchorComments; profiles: ReadonlyMap<UUID, ProfileRow>; branches: ReadonlyMap<UUID, BranchRow> };

export interface UseAnchorCommentsResult {
  state: UseAnchorCommentsState;
  reload: () => void;
}

/**
 * Every thread anchored to one subject (Sprint M1b's element-page section
 * 6a, and the per-subject threads on the change/review page 6b), plus
 * every author's own profile in one batch — `listCommentsForAnchor`
 * doesn't join `atlas.profiles` itself (`src/db/comments.ts`'s own layering:
 * comments live in `public`, profiles in `atlas`, and neither module reaches
 * into the other's table), so this hook does the second query and hands
 * back a lookup instead of every consumer re-deriving the same author-id set.
 */
export function useAnchorComments(modelId: UUID | null, anchorType: AnchorType, anchorId: UUID | null): UseAnchorCommentsResult {
  const [state, setState] = useState<UseAnchorCommentsState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!modelId || !anchorId) {
      setState({ status: 'loading' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });

    listCommentsForAnchor(supabase, modelId, anchorType, anchorId)
      .then(async (data) => {
        const authorIds = new Set<UUID>();
        // Only the root's own `branch_id` — "a thread shows its anchor"
        // (`docs/HANDOFF-M1b-comments.md`'s Intent), one tag per thread,
        // not per reply.
        const branchIds = new Set<UUID>();
        for (const thread of data.threads) {
          authorIds.add(thread.root.author_id);
          if (thread.root.branch_id) branchIds.add(thread.root.branch_id);
          for (const reply of thread.replies) authorIds.add(reply.author_id);
        }
        const [profileRows, branchRows] = await Promise.all([listProfilesByIds(supabase, [...authorIds]), listBranchesByIds(supabase, [...branchIds])]);
        if (cancelled) return;
        const profiles = new Map(profileRows.map((p) => [p.user_id, p]));
        const branches = new Map(branchRows.map((b) => [b.id, b]));
        setState({ status: 'ready', data, profiles, branches });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Could not load comments.' });
      });

    return () => {
      cancelled = true;
    };
  }, [modelId, anchorType, anchorId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  return { state, reload };
}
