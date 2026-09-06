import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { buildCommitLoader } from '../../db/commitLoader';
import { refParamOf, resolveRef, type Ref } from '../../db/ref';
import { foldFromGenesis } from '../../engine/head';
import { computeVersionDiff, type VersionDiff } from '../../engine/versionDiff';
import { supabase } from '../supabaseClient';

export interface VersionDiffData {
  asIsCommitId: UUID;
  toBeCommitId: UUID;
  diff: VersionDiff;
}

export type VersionDiffState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  /** Either ref didn't resolve to a commit (an unknown tag name, or a model with no commits yet). */
  | { status: 'refNotFound' }
  | { status: 'ready'; data: VersionDiffData };

/**
 * Computes the version diff (UI-principles §6.2/§6.3) between two refs —
 * `toBe` (`?ref=`) and `asIs` (`?diff=`). One `buildCommitLoader` call
 * shared by both folds: they're commits on the *same* model, so this is
 * one round trip for commits/deltas, not two.
 */
export function useVersionDiff(modelId: UUID, toBe: Ref, asIs: Ref): VersionDiffState {
  const [state, setState] = useState<VersionDiffState>({ status: 'loading' });
  const toBeParam = refParamOf(toBe);
  const asIsParam = refParamOf(asIs);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      const [toBeCommitId, asIsCommitId] = await Promise.all([resolveRef(supabase, modelId, toBe), resolveRef(supabase, modelId, asIs)]);
      if (!toBeCommitId || !asIsCommitId) {
        if (!cancelled) setState({ status: 'refNotFound' });
        return;
      }

      const loader = await buildCommitLoader(supabase, modelId);
      const toBeHead = foldFromGenesis(toBeCommitId, loader);
      const asIsHead = foldFromGenesis(asIsCommitId, loader);
      const diff = computeVersionDiff(asIsHead, toBeHead);

      if (!cancelled) setState({ status: 'ready', data: { asIsCommitId, toBeCommitId, diff } });
    }

    load().catch((e: unknown) => {
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to compute the version diff' });
    });

    return () => {
      cancelled = true;
    };
    // `toBeParam`/`asIsParam` (stable strings) are the real dependencies — same pitfall/fix as every other view hook here.
  }, [modelId, toBeParam, asIsParam]);

  return state;
}
