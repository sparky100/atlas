/**
 * The Portfolio rows, built from already-loaded systems, modules, capabilities,
 * actors and edges. Lifted out of `usePortfolio.ts` unchanged (ADR-028: the
 * model tools and the saved-report runner need the same rows without
 * importing `src/ui`). Pure: no I/O, and the clock is passed in.
 *
 * Signals are computed over *every* system and module regardless of any
 * display toggle, so the container-inclusion toggle can never change what the
 * overlap signal sees.
 */
import type { AnnualRunCost, Criticality, Disposition, FitForPurpose, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { attributesRecord } from '../elementRead/attributesRecord';
import { CRITICALITY_ORDER } from '../elementRead/criticality';
import { dispositionOf } from '../elementRead/disposition';
import { fitForPurposeOf, hasLifecycleExposureData, systemsExposedByLifecycle, worstFitForPurposeOfSupporter } from '../elementRead/fitAndExposure';
import { moduleDisplayNameFromMap } from '../elementRead/moduleDisplayName';
import { ownersByRole } from '../elementRead/ownersByRole';
import { annualRunCostOf, highCostOverlapByCapability, overlapCapabilityIdsFor, topLevelSupporterBands, topLevelSystemIdOf } from './portfolioOverlap';
import { computePortfolioSignals, missingPortfolioInputs, type PortfolioSignal } from './portfolioSignals';

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


export interface PortfolioInputs {
  systems: readonly ElementsHeadRow[];
  containers: readonly ElementsHeadRow[];
  capabilities: readonly ElementsHeadRow[];
  actors: readonly ElementsHeadRow[];
  /** `supports` edges from any system or module. */
  supportsEdges: readonly RelationshipsHeadRow[];
  /** `owns` edges into any system or module. */
  ownsEdges: readonly RelationshipsHeadRow[];
  now: Date;
}

export function buildPortfolioRows({ systems, containers, capabilities, actors, supportsEdges, ownsEdges, now }: PortfolioInputs): { rows: PortfolioRow[]; capabilitiesById: Map<UUID, ElementsHeadRow> } {
  // Every system and module container together: a module can carry its own `supports`/`owns` edges independently of its platform.
  const allElements = [...systems, ...containers];
  const elementsById = new Map<UUID, ElementsHeadRow>(allElements.map((e) => [e.element_id, e]));
  const capabilitiesById = new Map<UUID, ElementsHeadRow>(capabilities.map((c) => [c.element_id, c]));
  const actorsById = new Map<UUID, ElementsHeadRow>(actors.map((a) => [a.element_id, a]));
  const overlapsByCapability = highCostOverlapByCapability(supportsEdges, elementsById);
  
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

  return { rows, capabilitiesById };
}
