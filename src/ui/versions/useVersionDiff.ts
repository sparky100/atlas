import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getCommitTitles } from '../../db/modelHome';
import { refParamOf, resolveRef, type Ref } from '../../db/ref';
import { computeVersionDiff, type VersionDiff } from '../../engine/versionDiff';
import { reportError } from '../errors/errorBannerStore';
import { loadHeadAtCommitCached } from '../query/cachedBranchProjection';
import { supabase } from '../supabaseClient';

export interface VersionDiffData {
  asIsCommitId: UUID;
  toBeCommitId: UUID;
  diff: VersionDiff;
  /** Each side's own commit `title` (`db/modelHome.ts`'s `getCommitTitles`), keyed by commit id — lets the page's own "Diff: {asIs} → {toBe}" heading (`refLabelOf`'s `commitTitle` param) read as something a reader recognises ("Merge: Datasphere") rather than a bare hash fragment neither side has memorised. A commit that isn't found (rare — a stale/deleted id) simply falls back to the short id fragment `refLabelOf` already used before this, since the map has no entry for it. */
  commitTitles: Map<UUID, string>;
}

export type VersionDiffState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  /** Either ref didn't resolve to a commit (an unknown tag name, or a model with no commits yet). */
  | { status: 'refNotFound' }
  | { status: 'ready'; data: VersionDiffData };

/**
 * Computes the version diff (UI-principles §6.2/§6.3) between two refs —
 * `toBe` (`?ref=`) and `asIs` (`?diff=`). E8 item (2): both folds go
 * through `loadHeadAtCommitCached`, cached by commit id — a repeat visit
 * to the same diff, or a diff sharing one side with something another
 * hook already folded (e.g. `toBe` also being the branch head an element
 * page just opened), costs nothing beyond the cache lookup. This trades
 * away the old version's own "one `buildCommitLoader` call for both
 * folds" optimisation on a cold cache (each side now resolves its own
 * loader independently) for the cache's own cross-call reuse — the same
 * tradeoff `cachedBranchProjection.ts`'s own module comment makes for
 * `resolveBranchModeProjectionCached`.
 */
export function useVersionDiff(modelId: UUID, toBe: Ref, asIs: Ref): VersionDiffState {
  const [state, setState] = useState<VersionDiffState>({ status: 'loading' });
  const toBeParam = refParamOf(toBe);
  const asIsParam = refParamOf(asIs);

  useEffect(() => {
    // S1 item 15: guard on `modelId` — same fix as `useBreadcrumbElement.ts`'s
    // own precedent for this exact shape (a caller's `model?.id ?? ''` fires
    // this effect once before its own model resolves; left unguarded,
    // `reportError`'s new catch-all here would otherwise post a banner that
    // outlives the load that follows it).
    if (!modelId) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      const [toBeCommitId, asIsCommitId] = await Promise.all([resolveRef(supabase, modelId, toBe), resolveRef(supabase, modelId, asIs)]);
      if (!toBeCommitId || !asIsCommitId) {
        if (!cancelled) setState({ status: 'refNotFound' });
        return;
      }

      const [toBeHead, asIsHead, commitTitles] = await Promise.all([
        loadHeadAtCommitCached(supabase, modelId, toBeCommitId),
        loadHeadAtCommitCached(supabase, modelId, asIsCommitId),
        getCommitTitles(supabase, [toBeCommitId, asIsCommitId]),
      ]);
      const diff = computeVersionDiff(asIsHead, toBeHead);

      if (!cancelled) setState({ status: 'ready', data: { asIsCommitId, toBeCommitId, diff, commitTitles } });
    }

    load().catch((e: unknown) => {
      reportError("Couldn't compute the version diff.", e);
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to compute the version diff' });
    });

    return () => {
      cancelled = true;
    };
    // `toBeParam`/`asIsParam` (stable strings) are the real dependencies — same pitfall/fix as every other view hook here.
  }, [modelId, toBeParam, asIsParam]);

  return state;
}
