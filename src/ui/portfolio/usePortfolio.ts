/**
 * Portfolio view's own data load: every System and module Container at
 * this ref, with cost/fit/criticality/lifecycle-exposure/capabilities-
 * served/business-owner and every signal already derived — the same
 * "resolve the ref once, fetch the model's own scope, derive everything
 * client-side" shape `useRoadmap.ts` already uses (five model-wide
 * loaders in one `Promise.all`, no per-row query — CLAUDE.md rule 8).
 *
 * Signals are computed once (`buildPortfolioRows`), over *every* system and module in the
 * model regardless of the containers-inclusion toggle — that toggle is
 * `PortfolioView.tsx`'s own display-only state; it must never change what
 * `highCostOverlapByCapability` sees; decision 3 of the sprint's own
 * go-ahead.
 */
import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { listCapabilitiesForMap } from '../../db/capabilityMap';
import { listActorsForLandscape, listContainersForLandscape, listOwnsEdgesForSystems, listSupportsEdgesForSystems, listSystemsForLandscape } from '../../db/landscape';
import { refParamOf, resolveRef, type Ref } from '../../db/ref';
import { buildPortfolioRows, type PortfolioRow } from '../../engine/portfolio/buildPortfolioRows';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export type { PortfolioCapabilityLink, PortfolioOtherSupporter, PortfolioRow } from '../../engine/portfolio/buildPortfolioRows';

export interface PortfolioData {
  commitId: UUID;
  rows: PortfolioRow[];
  capabilitiesById: Map<UUID, ElementsHeadRow>;
}

export type PortfolioState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'refNotFound' } | { status: 'ready'; data: PortfolioData };

export interface UsePortfolioResult {
  state: PortfolioState;
  reload: () => void;
}

export function usePortfolio(modelId: UUID, ref: Ref, mainCommitIdHint: UUID | null = null, { inlineErrors = false }: { inlineErrors?: boolean } = {}): UsePortfolioResult {
  const [state, setState] = useState<PortfolioState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const refParam = refParamOf(ref);

  useEffect(() => {
    if (!modelId) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      const commitId = ref.kind === 'main' && mainCommitIdHint ? mainCommitIdHint : await resolveRef(supabase, modelId, ref);
      if (!commitId) {
        if (!cancelled) setState({ status: 'refNotFound' });
        return;
      }

      const [systems, containers, capabilities, actors] = await Promise.all([
        listSystemsForLandscape(supabase, commitId),
        listContainersForLandscape(supabase, commitId),
        listCapabilitiesForMap(supabase, commitId),
        listActorsForLandscape(supabase, commitId),
      ]);
      // Every system and module container together — the same "systems and
      // their own modules share one id set for edge fetches" convention
      // `useLandscape.ts` already establishes, not just top-level systems:
      // a module can carry its own `supports`/`owns` edges independently of
      // its platform.
      const allElements = [...systems, ...containers];
      const allIds = allElements.map((e) => e.element_id);
      const [supportsEdges, ownsEdges] = await Promise.all([
        listSupportsEdgesForSystems(supabase, commitId, allIds),
        listOwnsEdgesForSystems(supabase, commitId, allIds),
      ]);

      const { rows, capabilitiesById } = buildPortfolioRows({ systems, containers, capabilities, actors, supportsEdges, ownsEdges, now: new Date() });

      if (!cancelled) setState({ status: 'ready', data: { commitId, rows, capabilitiesById } });
    }

    load().catch((e: unknown) => {
      if (cancelled) return;
      if (inlineErrors) console.error("Couldn't load the portfolio.", e);
      else reportError("Couldn't load the portfolio.", e);
      setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load the portfolio.' });
    });

    return () => {
      cancelled = true;
    };
    // `refParam` (a stable string), not `ref` itself — same pitfall/fix as
    // useLandscape.ts/useCapabilityMap.ts/useRoadmap.ts.
  }, [modelId, refParam, reloadToken, mainCommitIdHint, inlineErrors]);

  return {
    state,
    reload: () => {
      setReloadToken((t) => t + 1);
    },
  };
}
