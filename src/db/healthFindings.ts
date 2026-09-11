/**
 * The architect door's Health findings (Handoff 7d's architect-door
 * amendment, `docs/HANDOFF-7d-architect-door.md` — UI-principles §3.2's
 * own "below the fold" health chips, built here as the first real step
 * toward that fuller dashboard, not the whole of it). Three genuinely new
 * findings — systems with no capability, capabilities with no owner,
 * attributes stale past `STALE_AFTER_MONTHS` — plus the duplicates count
 * `useArchitectHome.ts` already wires to 0 until Q1 (ADR-019). Sprint U4-1
 * B5 adds a fifth: `uses`/`flows_to` relationships with no verb-phrase
 * label (`findUnlabeledVerbRelationships`).
 *
 * "Owner" here is a derived concept, not a direct column: capabilities
 * have no `owner` attribute of their own (`CAPABILITY_ORDER` is `code`/
 * `description`/`templateRef` only). `owns` relationships can point at a
 * capability directly (`actor→capability`, `relationshipTypeRules.ts`) or
 * at a system that supports it (the roll-up-through-`supports` shape
 * `computeExposureTone`, `src/db/modelHome.ts`, already uses for lifecycle
 * exposure) — `findCapabilitiesWithoutOwner` originally only checked the
 * second (a real bug, fixed alongside Sprint U4-1 B3: a capability with a
 * *direct* owner still showed as unowned). B3 also adds inheritance: a
 * capability counts as owned if it, or any ancestor (capped at a
 * grandparent — capability nesting is capped at 3 levels, ADR-016, the
 * same bound `src/ui/elements/capabilityDepth.ts` walks), is owned either
 * way — and the finding lists only the *highest* unowned ancestor in each
 * unowned subtree, since fixing that one fixes everything under it.
 */
import { isStale, monthsSince, monthsUntil, STALE_AFTER_MONTHS } from '../contracts/thresholds';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../contracts/rows';
import type { UUID } from '../contracts/delta';
import { attributesRecord } from '../ui/elements/attributesRecord';
import type { Client } from './client';
import { selectAll } from './selectAll';

/** All `owns` edges at `commitId` — the ownership-rollup half of the health findings, same shape as `listAllSupportsEdges` (`src/db/modelHome.ts`) for the exposure-rollup half. */
export async function listAllOwnsEdges(supabase: Client, commitId: string): Promise<RelationshipsHeadRow[]> {
  const query = supabase
    .from('relationships_head')
    .select('relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id', { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('relationship_type', 'owns')
    .order('relationship_id');
  return selectAll<RelationshipsHeadRow>(query);
}

/** All `uses`/`flows_to` edges at `commitId` — Sprint U4-1 B5's "missing a label" finding. `.in(relationship_type, ['uses', 'flows_to'])` is a small fixed enum, not a caller-supplied list that grows with the model (CLAUDE.md rule 8) — same shape `src/db/landscape.ts`'s own `.in('relationship_type', ['uses', 'flows_to'])` already uses. */
export async function listAllUsesAndFlowsToEdges(supabase: Client, commitId: string): Promise<RelationshipsHeadRow[]> {
  const query = supabase
    .from('relationships_head')
    .select('relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id', { count: 'exact' })
    .eq('commit_id', commitId)
    .in('relationship_type', ['uses', 'flows_to'])
    .order('relationship_id');
  return selectAll<RelationshipsHeadRow>(query);
}

/**
 * Every element `uses`/`flows_to` can legally touch (`relationshipTypeRules.ts`:
 * system↔system, container↔container, component↔component, container→system,
 * component→container) — one commit-scoped query filtered by a fixed
 * 3-value `element_type` list, not an `.in(element_id, ...)` sized by
 * however many unlabeled edges this finding turns up (CLAUDE.md rule 8;
 * same reasoning `listAllUsesAndFlowsToEdges` above gives for its own
 * `.in()`). `findUnlabeledVerbRelationships`'s only use for these rows is
 * `name`, for the finding's own named examples.
 */
export async function listUsesAndFlowsToEndpointElements(supabase: Client, commitId: string): Promise<ElementsHeadRow[]> {
  const query = supabase
    .from('elements_head')
    .select('element_id, element_type, name, parent_id, attributes, exists_delta_id', { count: 'exact' })
    .eq('commit_id', commitId)
    .in('element_type', ['system', 'container', 'component'])
    .order('element_id');
  return selectAll<ElementsHeadRow>(query);
}

export interface UnlabeledVerbRelationship {
  relationshipId: UUID;
  relationshipType: 'uses' | 'flows_to';
  fromName: string;
  toName: string;
}

/**
 * `uses`/`flows_to` edges with no verb-phrase label — Sprint U4-1 B5's
 * "review checklist flags any without one": RelationshipAdd.tsx requires
 * one for every *new* edge of either type going forward, but this is what
 * catches one that predates that requirement (or reached `relationships_head`
 * some other way — capture, a script). "Unlabeled" is `attributes.description`
 * missing, `null`, or blank — the same three-state check
 * `src/db/syncDescriptionsFromMap.ts`'s own "empty description" candidate
 * filter already uses.
 */
export function findUnlabeledVerbRelationships(edges: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>): UnlabeledVerbRelationship[] {
  const result: UnlabeledVerbRelationship[] = [];
  for (const edge of edges) {
    if (edge.relationship_type !== 'uses' && edge.relationship_type !== 'flows_to') continue;
    const description = attributesRecord(edge.attributes).description;
    if (typeof description === 'string' && description.trim() !== '') continue;

    result.push({
      relationshipId: edge.relationship_id,
      relationshipType: edge.relationship_type,
      fromName: elementsById.get(edge.from_element_id)?.name ?? edge.from_element_id,
      toName: elementsById.get(edge.to_element_id)?.name ?? edge.to_element_id,
    });
  }
  return result;
}

/** Every fact at `commitId`, unfiltered by subject — callers scope to the systems they care about (health findings only reads systems' own attributes, not every subject in the model). Routed through `selectAll` (SPEC §6.7): `facts` is one of the tables `max_rows` can silently truncate. */
export async function listFactsForCommit(supabase: Client, commitId: string): Promise<FactsRow[]> {
  const query = supabase.from('facts').select('*', { count: 'exact' }).eq('commit_id', commitId).order('subject_id').order('attribute');
  return selectAll<FactsRow>(query);
}

/** Systems with no `supports` edge into any capability at all — Handoff 7d's "systems not linked to a capability" finding. */
export function findSystemsWithoutCapability(systems: readonly ElementsHeadRow[], supportsEdges: readonly RelationshipsHeadRow[]): ElementsHeadRow[] {
  const linkedSystemIds = new Set(supportsEdges.map((edge) => edge.from_element_id));
  return systems.filter((system) => !linkedSystemIds.has(system.element_id));
}

/**
 * Whether `capability` counts as owned, `selfOwnedIds`-owned itself or
 * through an ancestor — capped at a grandparent walk, same bound as
 * `capabilityLevel`/`l1AncestorOf` (`src/ui/elements/capabilityDepth.ts`).
 * Exported alongside `computeSelfOwnedCapabilityIds` below so a caller that
 * needs the raw predicate (rather than `findCapabilitiesWithoutOwner`'s own
 * "highest ancestor only" list) — none today; both exist so the reasoning
 * is reusable, not duplicated, if one shows up — isn't stuck re-deriving
 * this same two-function shape itself.
 */
export function isCapabilityOwnedWithAncestry(capability: ElementsHeadRow, selfOwnedIds: ReadonlySet<UUID>, capabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>): boolean {
  if (selfOwnedIds.has(capability.element_id)) return true;
  const parent = capability.parent_id !== null ? capabilitiesById.get(capability.parent_id) : undefined;
  if (!parent) return false;
  if (selfOwnedIds.has(parent.element_id)) return true;
  const grandparent = parent.parent_id !== null ? capabilitiesById.get(parent.parent_id) : undefined;
  return grandparent !== undefined && selfOwnedIds.has(grandparent.element_id);
}

/**
 * Every capability with a direct `role: 'business'` `owns` edge, or
 * reached by a `supports` edge from a system that has one — a capability's
 * own "owned by itself" set, before ancestry is taken into account
 * (`isCapabilityOwnedWithAncestry` above). Exported for the same reuse
 * reason as that function.
 *
 * Prompt 7k item 2's own finding is specifically "capabilities without a
 * *business* owner" — deliberately narrower than "any owner at all" (a
 * capability with only a technical or service owner still counts as
 * unowned here), the same distinction `findSystemsWithoutTechnicalOwner`
 * below draws in the other direction. This also preserves this finding's
 * pre-7k behaviour exactly once a model's data is migrated: the backfill
 * (`src/db/backfillOwnsRole.ts`, a real commit, not a row edit — see its
 * own comment) sets every existing `primary: true` edge's `role` to
 * `'business'`, so a capability that counted as owned before this sprint
 * still does, once that commit lands on its model's main.
 */
export function computeSelfOwnedCapabilityIds(capabilities: readonly ElementsHeadRow[], supportsEdges: readonly RelationshipsHeadRow[], ownsEdges: readonly RelationshipsHeadRow[]): Set<UUID> {
  const businessOwnedIds = new Set(ownsEdges.filter((edge) => attributesRecord(edge.attributes).role === 'business').map((edge) => edge.to_element_id));
  const capabilityIds = new Set(capabilities.map((c) => c.element_id));
  const directlyOwned = [...businessOwnedIds].filter((id) => capabilityIds.has(id));
  const ownedViaSupportingSystem = supportsEdges.filter((edge) => businessOwnedIds.has(edge.from_element_id)).map((edge) => edge.to_element_id);
  return new Set([...directlyOwned, ...ownedViaSupportingSystem]);
}

/** Systems with no `owns` edge carrying `role: 'technical'` — Prompt 7k item 2's "systems without a technical owner" finding, the same shape `findSystemsWithoutCapability` above already uses. */
export function findSystemsWithoutTechnicalOwner(systems: readonly ElementsHeadRow[], ownsEdges: readonly RelationshipsHeadRow[]): ElementsHeadRow[] {
  const technicallyOwnedIds = new Set(ownsEdges.filter((edge) => attributesRecord(edge.attributes).role === 'technical').map((edge) => edge.to_element_id));
  return systems.filter((system) => !technicallyOwnedIds.has(system.element_id));
}

/**
 * Capabilities with no owner, itself or inherited (this module's own
 * comment explains both halves of "owner"). Returns only the *highest*
 * unowned ancestor per unowned subtree — a child whose parent is also
 * unowned is implied, not listed separately, since linking an owner to the
 * parent fixes both.
 */
export function findCapabilitiesWithoutOwner(
  capabilities: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  ownsEdges: readonly RelationshipsHeadRow[],
): ElementsHeadRow[] {
  const selfOwnedIds = computeSelfOwnedCapabilityIds(capabilities, supportsEdges, ownsEdges);
  const capabilitiesById = new Map(capabilities.map((c) => [c.element_id, c]));

  return capabilities.filter((capability) => {
    if (isCapabilityOwnedWithAncestry(capability, selfOwnedIds, capabilitiesById)) return false;
    const parent = capability.parent_id !== null ? capabilitiesById.get(capability.parent_id) : undefined;
    if (parent && !isCapabilityOwnedWithAncestry(parent, selfOwnedIds, capabilitiesById)) return false;
    return true;
  });
}

export interface StaleAttributesFinding {
  /** Distinct (system, attribute) facts older than `STALE_AFTER_MONTHS`. */
  staleFactCount: number;
  /** Distinct systems with at least one stale fact, sorted by name — Sprint U4-1 B3's collapsed-row/expand list (`element_id` order breaks ties, same stable-order convention `src/db/landscape.ts` uses throughout). */
  staleSystems: ElementsHeadRow[];
  /** The single oldest stale fact's age in whole years — `null` when there are no stale facts. */
  oldestAgeYears: number | null;
}

/** Handoff 7d's "N attributes stale over 12 months — across M systems · oldest Ky" finding, scoped to `systems`' own facts (not every subject in the model — capabilities/actors/relationships aren't this finding's concern). */
export function computeStaleAttributesFinding(facts: readonly FactsRow[], systems: readonly ElementsHeadRow[], now: Date = new Date()): StaleAttributesFinding {
  const systemsById = new Map(systems.map((s) => [s.element_id, s]));
  let staleFactCount = 0;
  let oldestMonths = 0;
  const staleSystemIds = new Set<UUID>();

  for (const fact of facts) {
    if (!systemsById.has(fact.subject_id)) continue;
    const dateStr = fact.effective_date ?? fact.asserted_at;
    const date = new Date(dateStr);
    if (!isStale(date, now)) continue;
    staleFactCount += 1;
    staleSystemIds.add(fact.subject_id);
    const months = monthsSince(date, now);
    if (months > oldestMonths) oldestMonths = months;
  }

  const staleSystems = [...staleSystemIds]
    .map((id) => systemsById.get(id))
    .filter((s): s is ElementsHeadRow => s !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name) || a.element_id.localeCompare(b.element_id));

  return { staleFactCount, staleSystems, oldestAgeYears: staleFactCount > 0 ? Math.floor(oldestMonths / 12) : null };
}

/**
 * Prompt 7k item 1's first new finding: "critical systems without a
 * business owner" — depends on item 2's role data, the same
 * `role === 'business'` reading `computeSelfOwnedCapabilityIds` above uses,
 * applied to systems directly rather than capabilities (`owns` can already
 * target either — `relationshipTypeRules.ts`).
 */
export function findCriticalSystemsWithoutBusinessOwner(systems: readonly ElementsHeadRow[], ownsEdges: readonly RelationshipsHeadRow[]): ElementsHeadRow[] {
  const businessOwnedIds = new Set(ownsEdges.filter((edge) => attributesRecord(edge.attributes).role === 'business').map((edge) => edge.to_element_id));
  return systems.filter((system) => attributesRecord(system.attributes).criticality === 'critical' && !businessOwnedIds.has(system.element_id));
}

/**
 * Prompt 7k item 1's second new finding: "critical systems exposed with no
 * planned replacement" — a system-level analogue of
 * `src/ui/capabilityMap/metrics.ts`'s own `lifecycleExposure` (a
 * capability-level rollup over its supporting systems); this reads a
 * system's own `plannedEnd` directly, no rollup needed. Same "no planned
 * replacement" simplification that file's module comment documents:
 * nothing today can record a planned replacement (UI-principles §10
 * decision 4's review-queue machinery doesn't exist yet), so that half of
 * the condition is vacuously true — this narrows correctly once it does,
 * not silently wrong now.
 */
export function findCriticalExposedSystems(systems: readonly ElementsHeadRow[], now: Date = new Date()): ElementsHeadRow[] {
  return systems.filter((system) => {
    const attrs = attributesRecord(system.attributes);
    if (attrs.criticality !== 'critical') return false;
    const plannedEndValue = attrs.plannedEnd;
    if (typeof plannedEndValue !== 'string') return false;
    const plannedEnd = new Date(plannedEndValue);
    if (Number.isNaN(plannedEnd.getTime())) return false;
    return monthsUntil(plannedEnd, now) <= STALE_AFTER_MONTHS;
  });
}

export { STALE_AFTER_MONTHS };
