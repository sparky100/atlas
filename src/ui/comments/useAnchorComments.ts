import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { listCommentsForAnchor, type AnchorComments } from '../../db/comments';
import { listProfilesByIds } from '../../db/profiles';
import type { AnchorType, ProfileRow } from '../../db/types';
import { supabase } from '../supabaseClient';

export type UseAnchorCommentsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: AnchorComments; profiles: ReadonlyMap<UUID, ProfileRow> };

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
        for (const thread of data.threads) {
          authorIds.add(thread.root.author_id);
          for (const reply of thread.replies) authorIds.add(reply.author_id);
        }
        const profileRows = await listProfilesByIds(supabase, [...authorIds]);
        if (cancelled) return;
        const profiles = new Map(profileRows.map((p) => [p.user_id, p]));
        setState({ status: 'ready', data, profiles });
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
