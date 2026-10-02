/**
 * Portfolio view's own data load: every System and module Container at
 * this ref, with cost/fit/criticality/lifecycle-exposure/capabilities-
 * served/business-owner and every signal already derived — the same
 * "resolve the ref once, fetch the model's own scope, derive everything
 * client-side" shape `useRoadmap.ts` already uses (five model-wide
 * loaders in one `Promise.all`, no per-row query — CLAUDE.md rule 8).
 *
 * Signals are computed here, once, over *every* system and module in the
 * model regardless of the containers-inclusion toggle — that toggle is
 * `PortfolioView.tsx`'s own display-only state; it must never change what
 * `highCostOverlapByCapability` sees; decision 3 of the sprint's own
 * go-ahead.
 */
import { useEffect, useState } from 'react';
import type { AnnualRunCost, Criticality, Disposition, FitForPurpose, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { listCapabilitiesForMap } from '../../db/capabilityMap';
import { listActorsForLandscape, listContainersForLandscape, listOwnsEdgesForSystems, listSupportsEdgesForSystems, listSystemsForLandscape } from '../../db/landscape';
import { refParamOf, resolveRef, type Ref } from '../../db/ref';
import { attributesRecord } from '../elements/attributesRecord';
import { CRITICALITY_ORDER } from '../elements/criticalityTone';
import { dispositionOf } from '../elements/disposition';
import { fitForPurposeOf, hasLifecycleExposureData, systemsExposedByLifecycle, worstFitForPurposeOfSupporter } from '../capabilityMap/metrics';
import { moduleDisplayNameFromMap } from '../elements/moduleDisplayName';
import { ownersByRole } from '../elements/ownersByRole';
import { reportError } from '../errors/errorBannerStore';
import { annualRunCostOf, highCostOverlapByCapability, overlapCapabilityIdsFor, topLevelSupporterBands, topLevelSystemIdOf } from './portfolioOverlap';
import { computePortfolioSignals, missingPortfolioInputs, type PortfolioSignal } from './portfolioSignals';
import { supabase } from '../supabaseClient';

/** One other top-level system supporting the same capability as this row — the row-expand's own "other supporters" list, named and with its own highest band into that capability (never this row's own top-level system). */
export interface PortfolioOtherSupporter {
  topLevelSystemId: UUID;
  name: string;
  cost: AnnualRunCost | null;
}

export interface PortfolioCapabilityLink {
  capabilityId: UUID;
  capabilityName: string;
  /** This row's own edge rating into this capability — `null` if unrated. */
  fit: FitForPurpose | null;
  /** F12 step 2: the `supports` edge itself — the gaps queue rates it in place. */
  relationship: RelationshipsHeadRow;
  otherSupporters: PortfolioOtherSupporter[];
}

export interface PortfolioRow {
  element: ElementsHeadRow;
  /** "{platform} · {module}" for a module container, plain name otherwise. */
  name: string;
  /** Itself for a system; its parent platform for a module container (`topLevelSystemIdOf`). */
  topLevelSystemId: UUID;
  cost: AnnualRunCost | null;
  fit: FitForPurpose | null;
  criticality: Criticality | null;
  /** F11: this row's own disposition — a module's own, never its platform's. */
  disposition: Disposition | null;
  lifecycleStatus: string | null;
  /** `null` when this row's own family has no recorded `plannedEnd` at all — unknown, never "not exposed" (decision 4). */
  lifecycleExposed: boolean | null;
  capabilities: PortfolioCapabilityLink[];
  businessOwner: ElementsHeadRow | null;
  /** F12 step 2: every live `owns` edge into this element, any role — empty means it has no owner at all. */
  ownsEdges: RelationshipsHeadRow[];
  signals: PortfolioSignal[];
  missingInputs: string[];
}

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

/** A container's own value, falling back to its parent platform's — same precedence `db/elementBrowse.ts`'s `criticalityOf`/`lifecycleStatusOf` already use; reimplemented here typed to `Criticality` rather than a bare string, since the signal functions need the real union, not just "some string". */
function criticalityOf(element: ElementsHeadRow, parent: ElementsHeadRow | null): Criticality | null {
  const own = attributesRecord(element.attributes).criticality;
  if (typeof own === 'string' && own in CRITICALITY_ORDER) return own as Criticality;
  if (element.element_type === 'container' && parent) {
    const inherited = attributesRecord(parent.attributes).criticality;
    if (typeof inherited === 'string' && inherited in CRITICALITY_ORDER) return inherited as Criticality;
  }
  return null;
}

/** Same own-value-else-parent precedence as `criticalityOf` above, for `lifecycleStatus` — kept as a display string (the Lifecycle column), not the exposure boolean (`lifecycleExposed`, derived separately below from `plannedEnd`). */
function lifecycleStatusOf(element: ElementsHeadRow, parent: ElementsHeadRow | null): string | null {
  const own = attributesRecord(element.attributes).lifecycleStatus;
  if (typeof own === 'string') return own;
  if (element.element_type === 'container' && parent) {
    const inherited = attributesRecord(parent.attributes).lifecycleStatus;
    if (typeof inherited === 'string') return inherited;
  }
  return null;
}

export function usePortfolio(modelId: UUID, ref: Ref, mainCommitIdHint: UUID | null = null): UsePortfolioResult {
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

      const elementsById = new Map<UUID, ElementsHeadRow>(allElements.map((e) => [e.element_id, e]));
      const capabilitiesById = new Map<UUID, ElementsHeadRow>(capabilities.map((c) => [c.element_id, c]));
      const actorsById = new Map<UUID, ElementsHeadRow>(actors.map((a) => [a.element_id, a]));
      const overlapsByCapability = highCostOverlapByCapability(supportsEdges, elementsById);
      const now = new Date();

      function nameOfTopLevel(topLevelId: UUID): string {
        const system = elementsById.get(topLevelId);
        return system ? moduleDisplayNameFromMap(system, elementsById) : '(unknown system)';
      }

      const rows: PortfolioRow[] = allElements.map((element) => {
        const parent = element.parent_id !== null ? elementsById.get(element.parent_id) ?? null : null;
        const topLevelSystemId = topLevelSystemIdOf(element);
        const cost = annualRunCostOf(element);
        const fit = worstFitForPurposeOfSupporter(element.element_id, supportsEdges);
        const criticality = criticalityOf(element, parent);
        const lifecycleStatus = lifecycleStatusOf(element, parent);
        const lifecycleExposed = hasLifecycleExposureData([element]) ? systemsExposedByLifecycle([element], now) : null;

        const capabilityLinks: PortfolioCapabilityLink[] = supportsEdges
          .filter((edge) => edge.relationship_type === 'supports' && edge.from_element_id === element.element_id)
          .map((edge) => {
            const capability = capabilitiesById.get(edge.to_element_id);
            const bands = topLevelSupporterBands(edge.to_element_id, supportsEdges, elementsById);
            const otherSupporters: PortfolioOtherSupporter[] = [...bands]
              .filter(([id]) => id !== topLevelSystemId)
              .map(([id, band]) => ({ topLevelSystemId: id, name: nameOfTopLevel(id), cost: band }));
            return { capabilityId: edge.to_element_id, capabilityName: capability?.name ?? '(unknown capability)', fit: fitForPurposeOf(edge), relationship: edge, otherSupporters };
          });

        const businessOwner = ownersByRole(element.element_id, ownsEdges, actorsById).get('business')?.[0] ?? null;

        const overlapCapabilityNames = overlapCapabilityIdsFor(topLevelSystemId, overlapsByCapability).map((id) => capabilitiesById.get(id)?.name ?? '(unknown capability)');
        const disposition = dispositionOf(element);
        const signals = computePortfolioSignals({ cost, fit, criticality, lifecycleExposed, overlapCapabilityNames, disposition });
        const missingInputs = missingPortfolioInputs({ cost, fit, criticality, lifecycleExposed });

        return {
          element,
          name: moduleDisplayNameFromMap(element, elementsById),
          topLevelSystemId,
          cost,
          fit,
          criticality,
          disposition,
          lifecycleStatus,
          lifecycleExposed,
          capabilities: capabilityLinks,
          businessOwner,
          ownsEdges: ownsEdges.filter((edge) => edge.to_element_id === element.element_id),
          signals,
          missingInputs,
        };
      });

      if (!cancelled) setState({ status: 'ready', data: { commitId, rows, capabilitiesById } });
    }

    load().catch((e: unknown) => {
      reportError("Couldn't load the portfolio.", e);
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load the portfolio.' });
    });

    return () => {
      cancelled = true;
    };
    // `refParam` (a stable string), not `ref` itself — same pitfall/fix as
    // useLandscape.ts/useCapabilityMap.ts/useRoadmap.ts.
  }, [modelId, refParam, reloadToken, mainCommitIdHint]);

  return {
    state,
    reload: () => {
      setReloadToken((t) => t + 1);
    },
  };
}
