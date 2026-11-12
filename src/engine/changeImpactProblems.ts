/**
 * Problems a change causes that the change page's "affected" lists don't
 * show (Simon, 2026-11-12: "show full impact"). Problems only — nothing is
 * returned for a healthy item (project UX rule), and every entry names the
 * elements it is about so the page can link straight to them.
 *
 * Two kinds:
 *  - a capability the change leaves with no system supporting it
 *    (reuses `capabilitiesLeftWithoutSystem`, the same read the future
 *    landscape summary uses);
 *  - the provider side of an integration (`uses` / `flows_to`, the `to`
 *    end). ADR-024 §8 deliberately keeps providers out of "affected
 *    capabilities" (gaining a consumer changes nothing about what a provider
 *    delivers), so this is a separate list, and it only reports the two
 *    ways a provider is a *problem*: a changed system depends on a provider
 *    that is reaching end of life, or the change removes a provider that
 *    something still depends on.
 *
 * Pure: heads and `now` in, plain data out.
 */
import type { Delta, UUID } from '../contracts/delta';
import { subjectOf } from '../contracts/delta';
import type { ElementsHeadRow } from '../contracts/rows';
import type { ElementRow, Head } from './deltas';
import { capabilitiesLeftWithoutSystem } from './plannedFuture';
import { plannedEndOf, replacedElementIds, systemsExposedByLifecycle } from './elementRead/fitAndExposure';
import { moduleDisplayName } from './elementRead/moduleDisplayName';

export interface NamedElement {
  id: UUID;
  name: string;
}

export interface CapabilityLeftWithoutSystem extends NamedElement {
  /** Systems that supported it before this change, so the row says what went. May be empty if they are all gone from the model. */
  formerSystems: NamedElement[];
}

export type ProviderProblem =
  /** A system this change touches depends on a provider that is reaching end of life (and has no replacement recorded). */
  | { kind: 'provider_ending'; consumer: NamedElement; provider: NamedElement; plannedEnd: string }
  /** This change removes a provider that another system still depends on. */
  | { kind: 'provider_removed'; consumer: NamedElement; provider: NamedElement };

export interface ImpactProblems {
  capabilitiesLeftWithoutSystem: CapabilityLeftWithoutSystem[];
  providerProblems: ProviderProblem[];
}

const EMPTY: ImpactProblems = { capabilitiesLeftWithoutSystem: [], providerProblems: [] };
export const NO_IMPACT_PROBLEMS: ImpactProblems = EMPTY;

function headRow(id: UUID, row: ElementRow): ElementsHeadRow {
  return { element_id: id, element_type: row.elementType, name: row.name, parent_id: row.parentId, attributes: row.attributes, exists_delta_id: row.existsDeltaId };
}

function isIntegration(type: string): boolean {
  return type === 'uses' || type === 'flows_to';
}

export function findImpactProblems(ownDeltas: readonly Delta[], asIsHead: Head, toBeHead: Head, now: Date): ImpactProblems {
  const element = (id: UUID): ElementRow | undefined => toBeHead.elements.get(id) ?? asIsHead.elements.get(id);
  const displayName = (id: UUID): string => {
    const row = element(id);
    if (!row) return id;
    const parent = row.elementType === 'container' && row.parentId !== null ? element(row.parentId) : undefined;
    return moduleDisplayName(headRow(id, row), parent && row.parentId !== null ? headRow(row.parentId, parent) : null);
  };
  const named = (id: UUID): NamedElement => ({ id, name: displayName(id) });
  /** The system an element stands for: itself, or a module's platform. */
  const owningSystemId = (id: UUID): UUID | null => {
    const row = element(id);
    if (row?.elementType === 'system') return id;
    if (row?.elementType === 'container' && row.parentId !== null && element(row.parentId)?.elementType === 'system') return row.parentId;
    return null;
  };

  // Capabilities left with no system.
  const capabilitiesLeft: CapabilityLeftWithoutSystem[] = capabilitiesLeftWithoutSystem(asIsHead, toBeHead).map((capabilityId) => {
    const former = new Set<UUID>();
    for (const rel of asIsHead.relationships.values()) {
      if (rel.relationshipType === 'supports' && rel.toElementId === capabilityId && asIsHead.elements.has(rel.fromElementId)) former.add(rel.fromElementId);
    }
    return { ...named(capabilityId), formerSystems: [...former].map(named).sort((a, b) => a.name.localeCompare(b.name)) };
  });
  capabilitiesLeft.sort((a, b) => a.name.localeCompare(b.name));

  // Systems this change touches on the consuming side (their own record or a module edited, or an integration they consume added/changed/removed).
  const touchedSystems = new Set<UUID>();
  for (const delta of ownDeltas) {
    const { subjectType, subjectId } = subjectOf(delta);
    if (subjectType === 'element') {
      const owner = owningSystemId(subjectId);
      if (owner !== null) touchedSystems.add(owner);
    } else {
      const rel = toBeHead.relationships.get(subjectId) ?? asIsHead.relationships.get(subjectId);
      if (rel && isIntegration(rel.relationshipType)) {
        const owner = owningSystemId(rel.fromElementId);
        if (owner !== null) touchedSystems.add(owner);
      }
    }
  }

  const problems: ProviderProblem[] = [];
  const seen = new Set<string>();
  const replacedIds = replacedElementIds(
    [...toBeHead.relationships.entries()].map(([id, r]) => ({ relationship_id: id, relationship_type: r.relationshipType, from_element_id: r.fromElementId, to_element_id: r.toElementId, attributes: r.attributes, exists_delta_id: r.existsDeltaId })),
  );

  // A touched system depends on a provider that is ending.
  for (const rel of toBeHead.relationships.values()) {
    if (!isIntegration(rel.relationshipType)) continue;
    const consumerSystem = owningSystemId(rel.fromElementId);
    if (consumerSystem === null || !touchedSystems.has(consumerSystem)) continue;
    const providerSystem = owningSystemId(rel.toElementId);
    const providerRow = providerSystem === null ? undefined : toBeHead.elements.get(providerSystem);
    if (providerSystem === null || !providerRow || providerSystem === consumerSystem) continue;
    const providerHead = headRow(providerSystem, providerRow);
    if (!systemsExposedByLifecycle([providerHead], now, replacedIds)) continue;
    const plannedEnd = plannedEndOf(providerHead);
    if (plannedEnd === null) continue;
    const key = `ending|${rel.fromElementId}|${providerSystem}`;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push({ kind: 'provider_ending', consumer: named(rel.fromElementId), provider: named(providerSystem), plannedEnd: plannedEnd.toISOString().slice(0, 10) });
  }

  // The change removes a provider that something still depends on.
  for (const rel of asIsHead.relationships.values()) {
    if (!isIntegration(rel.relationshipType)) continue;
    if (toBeHead.elements.has(rel.toElementId) || !asIsHead.elements.has(rel.toElementId)) continue; // provider survives, or was never there
    if (!toBeHead.elements.has(rel.fromElementId)) continue; // the consumer goes too
    const key = `removed|${rel.fromElementId}|${rel.toElementId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push({ kind: 'provider_removed', consumer: named(rel.fromElementId), provider: named(rel.toElementId) });
  }

  problems.sort((a, b) => a.consumer.name.localeCompare(b.consumer.name) || a.provider.name.localeCompare(b.provider.name));
  return { capabilitiesLeftWithoutSystem: capabilitiesLeft, providerProblems: problems };
}
