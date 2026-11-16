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
import { fitForPurposeOf, hasLifecycleExposureData, supportsEdgesInForce, systemsExposedByLifecycle, worstFitForPurposeOfSupporter } from '../elementRead/fitAndExposure';
import { moduleDisplayNameFromMap } from '../elementRead/moduleDisplayName';
import { ownersByRole } from '../elementRead/ownersByRole';
import { annualRunCostOf, highCostOverlapsFromBands, topLevelSupporterBandsByCapability, topLevelSystemIdOf } from './portfolioOverlap';
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
  /** Resolved on first expansion of this link. */
  readonly otherSupporters: PortfolioOtherSupporter[];
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
  /** ADR-001 amendment: every element with a live `replaces` edge pointing at it. A replaced system never reads as lifecycle-exposed, and never counts as an overlapping supporter of the capabilities its replacement now also supports. Optional so a caller that hasn't loaded `replaces` edges keeps the plain reading. */
  replacedIds?: ReadonlySet<UUID>;
}

function edgesByEndpoint(edges: readonly RelationshipsHeadRow[], endpoint: 'from_element_id' | 'to_element_id'): Map<UUID, RelationshipsHeadRow[]> {
  const byId = new Map<UUID, RelationshipsHeadRow[]>();
  for (const edge of edges) {
    const list = byId.get(edge[endpoint]);
    if (list) list.push(edge);
    else byId.set(edge[endpoint], [edge]);
  }
  return byId;
}

export function buildPortfolioRows({ systems, containers, capabilities, actors, supportsEdges, ownsEdges, now, replacedIds }: PortfolioInputs): { rows: PortfolioRow[]; capabilitiesById: Map<UUID, ElementsHeadRow> } {
  // Every system and module container together: a module can carry its own `supports`/`owns` edges independently of its platform.
  const allElements = [...systems, ...containers];
  const elementsById = new Map<UUID, ElementsHeadRow>(allElements.map((e) => [e.element_id, e]));
  const capabilitiesById = new Map<UUID, ElementsHeadRow>(capabilities.map((c) => [c.element_id, c]));
  const actorsById = new Map<UUID, ElementsHeadRow>(actors.map((a) => [a.element_id, a]));
  const supportsBySource = edgesByEndpoint(supportsEdges, 'from_element_id');
  const ownsByTarget = edgesByEndpoint(ownsEdges, 'to_element_id');
  // Overlap and "other supporters" only count links still in force, and never from a system already replaced: a replacement's capability links are copies, so the pair overlapping is the plan, not a finding.
  const supportsEdgesForOverlap = supportsEdgesInForce(supportsEdges, elementsById, now).filter((edge) => !replacedIds?.has(edge.from_element_id));
  const bandsByCapability = topLevelSupporterBandsByCapability(supportsEdgesForOverlap, elementsById);
  const overlapsBySystem = new Map<UUID, string[]>();
  for (const [capabilityId, systemsWithOverlap] of highCostOverlapsFromBands(bandsByCapability)) {
    const name = capabilitiesById.get(capabilityId)?.name ?? '(unknown capability)';
    for (const id of systemsWithOverlap) {
      const names = overlapsBySystem.get(id);
      if (names) names.push(name);
      else overlapsBySystem.set(id, [name]);
    }
  }

  const supportersByCapability = new Map<UUID, PortfolioOtherSupporter[]>();
  function supportersOf(capabilityId: UUID): PortfolioOtherSupporter[] {
    const cached = supportersByCapability.get(capabilityId);
    if (cached) return cached;
    const supporters: PortfolioOtherSupporter[] = [];
    for (const [id, cost] of bandsByCapability.get(capabilityId) ?? []) {
      const system = elementsById.get(id);
      supporters.push({ topLevelSystemId: id, name: system ? moduleDisplayNameFromMap(system, elementsById) : '(unknown system)', cost });
    }
    supportersByCapability.set(capabilityId, supporters);
    return supporters;
  }

  const rows: PortfolioRow[] = allElements.map((element) => {
    const parent = element.parent_id !== null ? elementsById.get(element.parent_id) ?? null : null;
    const topLevelSystemId = topLevelSystemIdOf(element);
    const cost = annualRunCostOf(element);
    const support = supportsBySource.get(element.element_id) ?? [];
    const ownership = ownsByTarget.get(element.element_id) ?? [];
    const fit = worstFitForPurposeOfSupporter(element.element_id, support);
    const criticality = criticalityOf(element, parent);
    const lifecycleStatus = lifecycleStatusOf(element, parent);
    const lifecycleExposed = hasLifecycleExposureData([element]) ? systemsExposedByLifecycle([element], now, replacedIds) : null;

    const capabilityLinks: PortfolioCapabilityLink[] = support
      .filter((edge) => edge.relationship_type === 'supports')
      .map((edge) => {
        const capability = capabilitiesById.get(edge.to_element_id);
        let otherSupporters: PortfolioOtherSupporter[] | undefined;
        return {
          capabilityId: edge.to_element_id,
          capabilityName: capability?.name ?? '(unknown capability)',
          fit: fitForPurposeOf(edge),
          relationship: edge,
          get otherSupporters() {
            otherSupporters ??= supportersOf(edge.to_element_id).filter((supporter) => supporter.topLevelSystemId !== topLevelSystemId);
            return otherSupporters;
          },
        };
      });

    const businessOwner = ownersByRole(element.element_id, ownership, actorsById).get('business')?.[0] ?? null;

    const overlapCapabilityNames = overlapsBySystem.get(topLevelSystemId) ?? [];
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
      ownsEdges: ownership,
      signals,
      missingInputs,
    };
  });

  return { rows, capabilitiesById };
}
