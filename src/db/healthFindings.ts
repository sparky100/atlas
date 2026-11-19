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
import { EXISTS_ATTRIBUTE } from '../contracts/delta';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../contracts/rows';
import type { SystemDomain, UUID } from '../contracts/delta';
import { computeCapabilityRollup } from '../ui/capabilityMap/capabilityRollup';
import { attributesRecord } from '../ui/elements/attributesRecord';
import { isPlatform } from '../ui/elements/systemKind';
import { resolveElementDomain } from '../ui/elements/systemDomain';
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

/** All `replaces` edges at `commitId` — ADR-001 amendment: `from_element_id` is the replacement, `to_element_id` the retiring element. Same fixed-type fetch as `listAllOwnsEdges` above (no caller-supplied id list, so no `.in()` hazard, CLAUDE.md rule 8). */
export async function listAllReplacesEdges(supabase: Client, commitId: string): Promise<RelationshipsHeadRow[]> {
  const query = supabase
    .from('relationships_head')
    .select('relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id', { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('relationship_type', 'replaces')
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
 * system↔system, container↔container, container→system) — one commit-scoped
 * query filtered by a fixed 2-value `element_type` list, not an
 * `.in(element_id, ...)` sized by however many unlabeled edges this finding
 * turns up (CLAUDE.md rule 8; same reasoning `listAllUsesAndFlowsToEdges`
 * above gives for its own `.in()`). `findUnlabeledVerbRelationships`'s only
 * use for these rows is `name`, for the finding's own named examples.
 */
export async function listUsesAndFlowsToEndpointElements(supabase: Client, commitId: string): Promise<ElementsHeadRow[]> {
  const query = supabase
    .from('elements_head')
    .select('element_id, element_type, name, parent_id, attributes, exists_delta_id', { count: 'exact' })
    .eq('commit_id', commitId)
    .in('element_type', ['system', 'container'])
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

export interface BoundaryCrossing {
  relationshipId: UUID;
  relationshipType: 'uses' | 'flows_to';
  fromElementId: UUID;
  toElementId: UUID;
  fromName: string;
  toName: string;
  fromDomain: SystemDomain;
  toDomain: SystemDomain;
  /** No verb-phrase label recorded — the same "empty/missing description" check `findUnlabeledVerbRelationships` already uses. */
  missingVerb: boolean;
  /** Only ever `true` for a `flows_to` edge — a `uses` edge has no `dataClassification` attribute to be missing, so it's always `false` here (this crossing is only ever flagged for a missing verb, never for a fact `uses` was never going to carry). */
  missingDataClassification: boolean;
}

/**
 * One domain is `'it'` and the other `'ot'` — `'hybrid'` never
 * participates on either side (ambiguous by construction: a hybrid
 * endpoint isn't clearly on one side of the boundary or the other),
 * Prompt 7k item 3's own judgment call for what counts as a "crossing" at
 * all. Exported so a second surface that needs the identical predicate —
 * the integration platform context diagram's own "IT/OT boundary
 * crossings highlighted" — reuses this single definition rather than
 * re-deriving it.
 */
export function isBoundaryCrossingPair(a: SystemDomain, b: SystemDomain): boolean {
  return (a === 'it' && b === 'ot') || (a === 'ot' && b === 'it');
}

/**
 * Every `uses`/`flows_to` edge whose two endpoints resolve to opposite
 * sides of the IT/OT boundary (`resolveElementDomain`, walking up to the
 * nearest System for a Container endpoint) — Prompt 7k item 3's
 * "Boundary crossings" list, reachable from the architect door
 * (`BoundaryCrossingsPage.tsx`), and the shared basis both this item's own
 * health finding (`findBoundaryCrossingsMissingVerb`, below) and item 5's
 * Assurance finding (classification only, PR5) are built from — one
 * crossing-detection pass, not two.
 */
export function findBoundaryCrossings(edges: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>): BoundaryCrossing[] {
  const result: BoundaryCrossing[] = [];
  for (const edge of edges) {
    if (edge.relationship_type !== 'uses' && edge.relationship_type !== 'flows_to') continue;
    const from = elementsById.get(edge.from_element_id);
    const to = elementsById.get(edge.to_element_id);
    if (!from || !to) continue;
    const fromDomain = resolveElementDomain(from, elementsById);
    const toDomain = resolveElementDomain(to, elementsById);
    if (!isBoundaryCrossingPair(fromDomain, toDomain)) continue;

    const attrs = attributesRecord(edge.attributes);
    const description = attrs.description;
    const missingVerb = !(typeof description === 'string' && description.trim() !== '');
    const dataClassification = attrs.dataClassification;
    const missingDataClassification = edge.relationship_type === 'flows_to' && !(typeof dataClassification === 'string' && dataClassification.trim() !== '');

    result.push({ relationshipId: edge.relationship_id, relationshipType: edge.relationship_type, fromElementId: from.element_id, toElementId: to.element_id, fromName: from.name, toName: to.name, fromDomain, toDomain, missingVerb, missingDataClassification });
  }
  return result;
}

/**
 * Prompt 7k item 3's own health finding: a crossing with no verb-phrase
 * label — a labelling/hygiene concern, distinct from item 5's Assurance
 * finding below (missing data classification, the CAF A3/B4-relevant
 * fact). Originally "missing classification or verb", which made a
 * crossing missing both appear as what looked like the same finding twice
 * — once here, once under Assurance — with no way to tell the two apart
 * (found during a walkthrough, issue-reported). Narrowed to verb-only so
 * each finding owns exactly one fact and a crossing is never flagged twice
 * for the same reason; a crossing missing only its data classification is
 * now Assurance's finding alone, not this one's too.
 */
export function findBoundaryCrossingsMissingVerb(edges: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>): BoundaryCrossing[] {
  return findBoundaryCrossings(edges, elementsById).filter((crossing) => crossing.missingVerb);
}

/**
 * Prompt 7k item 5's own Assurance finding: boundary crossings missing a
 * data classification specifically — the CAF A3/B4-relevant fact, and the
 * sole finding that flags it (item 3's own `findBoundaryCrossingsMissingVerb`
 * above covers the labelling concern only, not classification, precisely so
 * a crossing missing its classification is never flagged in both places).
 * Same `findBoundaryCrossings` pass, not a second detection (that
 * function's own module comment).
 */
export function findBoundaryCrossingsMissingClassification(edges: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>): BoundaryCrossing[] {
  return findBoundaryCrossings(edges, elementsById).filter((crossing) => crossing.missingDataClassification);
}

export interface ExternalInterfaceCrossing {
  relationshipId: UUID;
  relationshipType: 'uses' | 'flows_to';
  fromElementId: UUID;
  toElementId: UUID;
  fromName: string;
  toName: string;
}

/** A system/container counts as "external" for this finding either way ADR-001 lets it record the fact: `isExternal: true` outright, or an `externalOrganisation` actually named (S1 item 11a) — never an actor, which gets its own separate finding below. */
function isExternalInterfaceElement(element: ElementsHeadRow): boolean {
  if (element.element_type === 'actor') return false;
  const attrs = attributesRecord(element.attributes);
  if (attrs.isExternal === true) return true;
  return typeof attrs.externalOrganisation === 'string' && attrs.externalOrganisation.trim() !== '';
}

/**
 * S1 item 11a's own Assurance finding: a `flows_to` edge crossing the
 * external boundary — exactly one endpoint external,
 * `isExternalInterfaceElement` above, never both or neither (an edge
 * between two external systems, or two internal ones, isn't a boundary
 * crossing at all) — with no data classification recorded. `uses` is
 * excluded outright, same reasoning `findBoundaryCrossings`'s own
 * `missingDataClassification` already gives: `UsesAttributes` (delta.ts)
 * has no `dataClassification` attribute to be missing, so flagging a
 * `uses` edge here would be flagging a fact it never had anywhere to
 * carry. A sibling to Prompt 7k item 3's own IT/OT
 * `findBoundaryCrossings`, keyed on `isExternal`/`externalOrganisation`
 * instead of `domain` — deliberately its own pass, not a filter over that
 * one: the two boundaries (IT/OT vs. enterprise/external) are independent
 * facts about an edge and can cross one, both, or neither.
 */
export function findExternalInterfacesMissingClassification(edges: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>): ExternalInterfaceCrossing[] {
  const result: ExternalInterfaceCrossing[] = [];
  for (const edge of edges) {
    if (edge.relationship_type !== 'uses' && edge.relationship_type !== 'flows_to') continue;
    const from = elementsById.get(edge.from_element_id);
    const to = elementsById.get(edge.to_element_id);
    if (!from || !to) continue;
    const fromExternal = isExternalInterfaceElement(from);
    const toExternal = isExternalInterfaceElement(to);
    if (fromExternal === toExternal) continue; // both or neither — not a crossing.
    // `uses` has no `dataClassification` attribute today at all
    // (`UsesAttributes`, delta.ts) — same "only flows_to can be missing a
    // fact it never had a place to carry" reasoning `findBoundaryCrossings`'s
    // own `missingDataClassification` already applies. Written as a
    // relationship-type check rather than "does this edge's own attributes
    // happen to have the key" so it stays correct (and a genuine no-op)
    // rather than silently starting to flag every `uses` edge if `uses`
    // ever does gain the field later.
    if (edge.relationship_type !== 'flows_to') continue;
    const dataClassification = attributesRecord(edge.attributes).dataClassification;
    if (typeof dataClassification === 'string' && dataClassification.trim() !== '') continue;
    result.push({ relationshipId: edge.relationship_id, relationshipType: edge.relationship_type, fromElementId: from.element_id, toElementId: to.element_id, fromName: from.name, toName: to.name });
  }
  return result;
}

export interface ExternalOrganisationAccess {
  relationshipId: UUID;
  /** The external actor itself — the "PowerOn"-style organisation label is a display string, not always a stable id on its own, so this is the actual element to link to. */
  actorId: UUID;
  organisation: string;
  systemId: UUID;
  systemName: string;
}

/**
 * S1 item 11a's own second Assurance row: not a "problem" the way the
 * finding above is (there is no missing-metadata condition to flag — an
 * external actor `uses` edge is only ever legal at all with a verb phrase,
 * same as any other `uses` edge, Sprint U4-1 B5) — purely informational
 * visibility into which outside organisations can reach in at all, and
 * what they reach. One row per edge, not deduplicated by organisation: two
 * separate `uses` edges from the same external actor into two different
 * systems are two separate facts worth listing, not one.
 */
export function findExternalOrganisationAccess(edges: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>): ExternalOrganisationAccess[] {
  const result: ExternalOrganisationAccess[] = [];
  for (const edge of edges) {
    if (edge.relationship_type !== 'uses') continue;
    const actor = elementsById.get(edge.from_element_id);
    const target = elementsById.get(edge.to_element_id);
    if (!actor || !target || actor.element_type !== 'actor') continue;
    const attrs = attributesRecord(actor.attributes);
    if (attrs.isExternal !== true) continue;
    const organisation = typeof attrs.externalOrganisation === 'string' && attrs.externalOrganisation.trim() !== '' ? attrs.externalOrganisation : actor.name;
    result.push({ relationshipId: edge.relationship_id, actorId: actor.element_id, organisation, systemId: target.element_id, systemName: target.name });
  }
  return result;
}

/**
 * Prompt 7k item 4's own health finding: every system with
 * `kind: 'integration_platform'` that no live `uses`/`flows_to` edge
 * names as its `via` — a platform recorded in the model but not actually
 * routing anything, worth a second look (has it been decommissioned? is
 * a real flow missing its `via`?). `usesAndFlowsToEdges` is the same
 * commit-scoped edge list `findBoundaryCrossings`/
 * `findUnlabeledVerbRelationships` already read (`listAllUsesAndFlowsToEdges`)
 * — reused here rather than a second query, since `via` presence is just
 * another attribute on the same rows.
 */
export function findUnusedIntegrationPlatforms(systems: readonly ElementsHeadRow[], usesAndFlowsToEdges: readonly RelationshipsHeadRow[], containers: readonly ElementsHeadRow[] = []): ElementsHeadRow[] {
  // ADR-026: a via naming one of the platform's interfaces (a container
  // whose parent is the platform) routes through the platform too.
  const parentIdByContainerId = new Map(containers.flatMap((c) => (c.parent_id !== null ? [[c.element_id, c.parent_id] as const] : [])));
  const platformIdsInUse = new Set<UUID>();
  for (const via of viaIdsOf(usesAndFlowsToEdges)) {
    platformIdsInUse.add(via);
    const parentId = parentIdByContainerId.get(via);
    if (parentId !== undefined) platformIdsInUse.add(parentId);
  }
  return systems.filter((system) => isIntegrationPlatformSystem(system) && !platformIdsInUse.has(system.element_id));
}

/**
 * ADR-026's own health finding: every interface — a container whose parent
 * is an integration platform — that no live `uses`/`flows_to` edge names as
 * its `via`. The interface-level twin of `findUnusedIntegrationPlatforms`:
 * a recorded API or feed nothing is shown to use. Each row comes back
 * named "Platform · Interface", the way every other surface names a module.
 */
export function findUnusedIntegrationInterfaces(systems: readonly ElementsHeadRow[], containers: readonly ElementsHeadRow[], usesAndFlowsToEdges: readonly RelationshipsHeadRow[]): ElementsHeadRow[] {
  const platformsById = new Map(systems.filter(isIntegrationPlatformSystem).map((s) => [s.element_id, s]));
  const viaIds = new Set(viaIdsOf(usesAndFlowsToEdges));
  return containers.flatMap((container) => {
    const platform = container.parent_id !== null ? platformsById.get(container.parent_id) : undefined;
    if (!platform || viaIds.has(container.element_id)) return [];
    return [{ ...container, name: `${platform.name} · ${container.name}` }];
  });
}

function isIntegrationPlatformSystem(row: ElementsHeadRow): boolean {
  return row.element_type === 'system' && attributesRecord(row.attributes).kind === 'integration_platform';
}

function viaIdsOf(edges: readonly RelationshipsHeadRow[]): UUID[] {
  return edges.flatMap((edge) => {
    const via = attributesRecord(edge.attributes).via;
    return typeof via === 'string' ? [via] : [];
  });
}

/** Every fact at `commitId`, unfiltered by subject — callers scope to the systems they care about (health findings only reads systems' own attributes, not every subject in the model). Routed through `selectAll` (SPEC §6.7): `facts` is one of the tables `max_rows` can silently truncate. */
export async function listFactsForCommit(supabase: Client, commitId: string): Promise<FactsRow[]> {
  const query = supabase.from('facts').select('*', { count: 'exact' }).eq('commit_id', commitId).order('subject_id').order('attribute');
  return selectAll<FactsRow>(query);
}

/** The only fact columns the stale-attributes finding reads. */
export type FactStalenessRow = Pick<FactsRow, 'subject_id' | 'attribute' | 'effective_date' | 'asserted_at'>;

/**
 * Just what `computeStaleAttributesFinding` needs — `subject_id`, `attribute` (to skip `$exists`) and the two dates — for element facts only. Same facts, a fraction of the payload `listFactsForCommit` (`select *`, values and provenance included) sends; Home's findings used to download all of it to read three columns. Routed through `selectAll` (SPEC §6.7).
 */
export async function listFactStalenessForCommit(supabase: Client, commitId: string): Promise<FactStalenessRow[]> {
  const query = supabase
    .from('facts')
    .select('subject_id,attribute,effective_date,asserted_at', { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('subject_type', 'element')
    .order('subject_id')
    .order('attribute');
  return selectAll<FactStalenessRow>(query);
}

/** Every `container` in `containers`, grouped by its own `parent_id` — a platform's modules, keyed by the platform's own element id. Shared by `findSystemsWithoutCapability` and `findPlatformSupportsThatShouldMoveToModule` below so the two findings never define "this platform's modules" two different ways. */
function groupModulesByPlatformId(containers: readonly ElementsHeadRow[]): Map<UUID, ElementsHeadRow[]> {
  const result = new Map<UUID, ElementsHeadRow[]>();
  for (const module of containers) {
    if (module.parent_id === null) continue;
    const existing = result.get(module.parent_id);
    if (existing) existing.push(module);
    else result.set(module.parent_id, [module]);
  }
  return result;
}

/**
 * Systems with no `supports` edge into any capability at all — Handoff 7d's
 * "systems not linked to a capability" finding.
 *
 * S1 item 19: "Platforms and modules" (ADR-000's amendment) put a
 * platform's own `supports` edge on its modules (`container`s), never on
 * the platform itself — so a platform whose modules are fully linked used
 * to still show up here every time, since nothing ever checked a
 * `from_element_id` that wasn't the platform's own. `containers` (every
 * `container` element in the model, optional and defaulting to `[]` for
 * every caller that never has a platform to worry about) lets a platform
 * count as linked through any of its modules; a platform with no modules
 * at all is judged on its own `supports` edge, same as before — there is
 * nowhere lower to check.
 */
export function findSystemsWithoutCapability(
  systems: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  containers: readonly ElementsHeadRow[] = [],
  usesAndFlowsToEdges: readonly RelationshipsHeadRow[] = [],
): ElementsHeadRow[] {
  const linkedElementIds = new Set(supportsEdges.map((edge) => edge.from_element_id));
  const modulesByPlatformId = groupModulesByPlatformId(containers);
  const parentById = new Map<UUID, UUID>();
  for (const module of containers) if (module.parent_id !== null) parentById.set(module.element_id, module.parent_id);
  /** The system an element belongs to: a module's own platform, otherwise itself. */
  const owningSystemId = (id: UUID): UUID => parentById.get(id) ?? id;
  // A2 platform dependency rule (one hop, deliberately): a platform with no
  // capability link of its own is NOT flagged when something that does
  // serve a capability uses it, flows to/from it, or routes through it
  // (`via`) — "no capability link recorded" is not "no business use found".
  const servesCapability = (id: UUID): boolean => linkedElementIds.has(id) || (modulesByPlatformId.get(id) ?? []).some((m) => linkedElementIds.has(m.element_id));
  const reachedByServingSystem = (platform: ElementsHeadRow): boolean => {
    const ownIds = new Set<UUID>([platform.element_id, ...(modulesByPlatformId.get(platform.element_id) ?? []).map((m) => m.element_id)]);
    return usesAndFlowsToEdges.some((edge) => {
      const via = attributesRecord(edge.attributes).via;
      const touches = ownIds.has(edge.from_element_id) || ownIds.has(edge.to_element_id) || (typeof via === 'string' && ownIds.has(via));
      if (!touches) return false;
      return [edge.from_element_id, edge.to_element_id].some((end) => !ownIds.has(end) && servesCapability(owningSystemId(end)));
    });
  };
  return systems.filter((system) => {
    let unlinked = !linkedElementIds.has(system.element_id);
    if (isPlatform(system)) {
      const modules = modulesByPlatformId.get(system.element_id);
      if (modules && modules.length > 0) unlinked = !modules.some((module) => linkedElementIds.has(module.element_id));
    }
    return unlinked && !(isPlatform(system) && reachedByServingSystem(system));
  });
}

/**
 * S1 item 19's own informational nudge: a platform *with* modules that
 * itself still carries a direct `supports` edge — legal (`relationshipTypeRules.ts`
 * allows `supports` from a `system`, platform or not), but probably meant
 * for the module that actually does the work, the same way `RelationshipAdd.tsx`'s
 * own picker steers a fresh edge there. Not a "problem" the way
 * `findSystemsWithoutCapability` above is — the platform already counts as
 * linked either way — purely a "did you mean to put this on the module?"
 * visibility check, the same informational shape `findExternalOrganisationAccess`
 * already established. Vacuous for a platform with no modules: there's
 * nowhere lower to move the edge to, so it's never flagged.
 */
export function findPlatformSupportsThatShouldMoveToModule(
  systems: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  containers: readonly ElementsHeadRow[],
): ElementsHeadRow[] {
  const linkedElementIds = new Set(supportsEdges.map((edge) => edge.from_element_id));
  const modulesByPlatformId = groupModulesByPlatformId(containers);
  return systems.filter((system) => isPlatform(system) && (modulesByPlatformId.get(system.element_id)?.length ?? 0) > 0 && linkedElementIds.has(system.element_id));
}

export interface PlatformFlowEndpoint {
  relationshipId: UUID;
  relationshipType: 'uses' | 'flows_to';
  fromName: string;
  toName: string;
  /** Which side of the edge names the platform itself rather than one of its modules — `'both'` only when a platform with modules flows to/uses another platform with modules, naming itself on both ends. */
  platformSide: 'from' | 'to' | 'both';
}

/**
 * S1 item 20's own informational nudge, the `uses`/`flows_to` sibling of
 * `findPlatformSupportsThatShouldMoveToModule` above: once `uses`/`flows_to`
 * legally reach a `container`↔`system` pair either direction (this item's
 * own `relationshipTypeRules.ts` addition), an edge can now point straight
 * at a platform system itself instead of naming the specific module that
 * actually sends or receives the flow. Legal either way — this is purely a
 * "did you mean the module?" visibility check, same informational shape as
 * item 19's finding — and, per that same reasoning, vacuous for a platform
 * with no modules (nowhere lower to point the edge at). V1's own
 * context-diagram prompt (`docs/prompts/atlas-prompt-pack.md`'s "### V1"
 * section) originally paired this finding with a "which module?" marker
 * drawn right on the platform's own edge; V3 ("container context pages,
 * platform context simplified to structure only") replaced that
 * rendering with `computePlatformConnections`'s plain-text "Platform-level
 * connections" line on the platform's own structure page instead — this
 * finding itself is unchanged, still the same "did you mean the module?"
 * data-quality nudge, independent of how the Context view happens to
 * render it.
 */
export function findFlowsToPlatformInsteadOfModule(edges: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>): PlatformFlowEndpoint[] {
  const containers = [...elementsById.values()].filter((el) => el.element_type === 'container');
  const modulesByPlatformId = groupModulesByPlatformId(containers);
  const platformsWithModulesIds = new Set(
    [...elementsById.values()].filter((el) => el.element_type === 'system' && isPlatform(el) && (modulesByPlatformId.get(el.element_id)?.length ?? 0) > 0).map((el) => el.element_id),
  );

  const result: PlatformFlowEndpoint[] = [];
  for (const edge of edges) {
    if (edge.relationship_type !== 'uses' && edge.relationship_type !== 'flows_to') continue;
    const fromIsPlatform = platformsWithModulesIds.has(edge.from_element_id);
    const toIsPlatform = platformsWithModulesIds.has(edge.to_element_id);
    if (!fromIsPlatform && !toIsPlatform) continue;
    const from = elementsById.get(edge.from_element_id);
    const to = elementsById.get(edge.to_element_id);
    if (!from || !to) continue;
    const platformSide: PlatformFlowEndpoint['platformSide'] = fromIsPlatform && toIsPlatform ? 'both' : fromIsPlatform ? 'from' : 'to';
    result.push({ relationshipId: edge.relationship_id, relationshipType: edge.relationship_type, fromName: from.name, toName: to.name, platformSide });
  }
  return result;
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

/**
 * Systems (or, since `owns` reaches a container directly too, modules) with
 * no `owns` edge carrying `role: 'technical'` — Prompt 7k item 2's "systems
 * without a technical owner" finding, the same shape
 * `findSystemsWithoutCapability` above already uses. `elements` is whatever
 * mix of systems/containers the caller wants checked — this function has no
 * type check of its own, so a platform's own modules (frequently owned by a
 * different team than the platform itself) surface here exactly like a
 * top-level system does once the caller includes them.
 */
export function findSystemsWithoutTechnicalOwner(elements: readonly ElementsHeadRow[], ownsEdges: readonly RelationshipsHeadRow[]): ElementsHeadRow[] {
  const technicallyOwnedIds = new Set(ownsEdges.filter((edge) => attributesRecord(edge.attributes).role === 'technical').map((edge) => edge.to_element_id));
  return elements.filter((element) => !technicallyOwnedIds.has(element.element_id));
}

/**
 * AI agents that act alone (`aiAutonomy: 'acts_alone'`) and have no `owns`
 * edge with `role: 'technical'` — nobody is answerable for something that
 * acts without anyone checking first. Same technical-owner definition as
 * `findSystemsWithoutTechnicalOwner` above. A system with no `aiAutonomy`
 * is not an agent and is never flagged; one that suggests or acts with
 * approval has a person in the loop and is left to the general check.
 */
export function findAiAgentsActingAloneWithoutTechnicalOwner(elements: readonly ElementsHeadRow[], ownsEdges: readonly RelationshipsHeadRow[]): ElementsHeadRow[] {
  const technicallyOwnedIds = new Set(ownsEdges.filter((edge) => attributesRecord(edge.attributes).role === 'technical').map((edge) => edge.to_element_id));
  return elements.filter((element) => attributesRecord(element.attributes).aiAutonomy === 'acts_alone' && !technicallyOwnedIds.has(element.element_id));
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
  /** Distinct (element, attribute) facts older than the organisation's stale threshold. */
  staleFactCount: number;
  /** Distinct elements with at least one stale fact, sorted by name — Sprint U4-1 B3's collapsed-row/expand list (`element_id` order breaks ties, same stable-order convention `src/db/landscape.ts` uses throughout). */
  staleElements: ElementsHeadRow[];
  /** The single oldest stale fact's age in whole years — `null` when there are no stale facts. */
  oldestAgeYears: number | null;
}

/**
 * Which elements have a value that has not been updated or confirmed for
 * `staleAfterMonths` (the organisation's `stale_after_months`), scoped to the `elements`
 * passed in — every element type, not only systems. Relationships are left
 * out: "Still accurate" (ADR-025) cannot confirm them yet, so flagging one
 * would be a finding nobody can clear.
 *
 * The `$exists` fact is skipped. It records that the element was created and
 * "Still accurate" never re-asserts it, so counting it would keep every old
 * element on the list after its owner had confirmed it.
 *
 * SQL twin: `atlas.stale_elements` (20261113040000_stale_threshold_and_nudges.sql),
 * which decides who gets the reminder email — keep the two rules identical.
 */
export function computeStaleAttributesFinding(facts: readonly FactStalenessRow[], elements: readonly ElementsHeadRow[], now: Date = new Date(), staleAfterMonths: number = STALE_AFTER_MONTHS): StaleAttributesFinding {
  const systemsById = new Map(elements.map((s) => [s.element_id, s]));
  let staleFactCount = 0;
  let oldestMonths = 0;
  const staleSystemIds = new Set<UUID>();

  for (const fact of facts) {
    if (fact.attribute === EXISTS_ATTRIBUTE || !systemsById.has(fact.subject_id)) continue;
    const dateStr = fact.effective_date ?? fact.asserted_at;
    const date = new Date(dateStr);
    if (!isStale(date, now, staleAfterMonths)) continue;
    staleFactCount += 1;
    staleSystemIds.add(fact.subject_id);
    const months = monthsSince(date, now);
    if (months > oldestMonths) oldestMonths = months;
  }

  const staleElements = [...staleSystemIds]
    .map((id) => systemsById.get(id))
    .filter((s): s is ElementsHeadRow => s !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name) || a.element_id.localeCompare(b.element_id));

  return { staleFactCount, staleElements, oldestAgeYears: staleFactCount > 0 ? Math.floor(oldestMonths / 12) : null };
}

/**
 * Prompt 7k item 1's first new finding: "critical systems without a
 * business owner" — depends on item 2's role data, the same
 * `role === 'business'` reading `computeSelfOwnedCapabilityIds` above uses,
 * applied to systems directly rather than capabilities (`owns` can already
 * target either — `relationshipTypeRules.ts`). `elements` is whatever mix
 * of systems/containers the caller wants checked — `criticality` is a
 * `ContainerAttributes` field too (a module can be criticality-rated
 * independently of its platform), so a critical, unowned module surfaces
 * here exactly like a critical, unowned system once the caller includes it.
 */
export function findCriticalSystemsWithoutBusinessOwner(elements: readonly ElementsHeadRow[], ownsEdges: readonly RelationshipsHeadRow[]): ElementsHeadRow[] {
  const businessOwnedIds = new Set(ownsEdges.filter((edge) => attributesRecord(edge.attributes).role === 'business').map((edge) => edge.to_element_id));
  return elements.filter((element) => attributesRecord(element.attributes).criticality === 'critical' && !businessOwnedIds.has(element.element_id));
}

/**
 * Prompt 7k item 1's second new finding: "critical systems exposed with no
 * planned replacement" — a system-level analogue of
 * `src/ui/capabilityMap/metrics.ts`'s own `lifecycleExposure` (a
 * capability-level rollup over its supporting systems); this reads a
 * system's own `plannedEnd` directly, no rollup needed. "No planned
 * replacement" (ADR-001 amendment) reads a real fact: a critical system in
 * `replacedIds` (the retiring side of a live `replaces` edge,
 * `replacedElementIds`) never counts as exposed, however near or past its
 * own `plannedEnd`. Existence-only, same as `lifecycleExposure`'s own
 * version of this check — the replacement's own lifecycle is deliberately
 * not considered. A caller that passes no `replacedIds` gets the plain
 * `plannedEnd` read.
 */
export function findCriticalExposedSystems(systems: readonly ElementsHeadRow[], now: Date = new Date(), replacedIds?: ReadonlySet<UUID>): ElementsHeadRow[] {
  return systems.filter((system) => {
    if (replacedIds?.has(system.element_id)) return false;
    const attrs = attributesRecord(system.attributes);
    if (attrs.criticality !== 'critical') return false;
    const plannedEndValue = attrs.plannedEnd;
    if (typeof plannedEndValue !== 'string') return false;
    const plannedEnd = new Date(plannedEndValue);
    if (Number.isNaN(plannedEnd.getTime())) return false;
    return monthsUntil(plannedEnd, now) <= STALE_AFTER_MONTHS;
  });
}

/**
 * Prompt 7k item 5's first Assurance finding: "systems supporting an
 * essential function without a technical owner" — NIS essential functions
 * are recorded at capability level (`CapabilityAttributes.essentialFunction`)
 * and derived down to systems through `supports`, the same rollup shape
 * `computeSelfOwnedCapabilityIds` above already uses in the other direction
 * (capability ownership derived from a supporting system's `owns` edge).
 * "Technical owner" reuses `findSystemsWithoutTechnicalOwner`'s own
 * `role: 'technical'` definition, scoped down to just the elements this
 * finding cares about. `elements` is whatever mix of systems/containers the
 * caller wants checked — `supports (container, capability)` already
 * qualifies a module as "supporting" here exactly like a system does, so a
 * module supporting an essential-function capability with no technical
 * owner of its own surfaces once the caller includes containers.
 */
export function findSystemsSupportingEssentialFunctionWithoutTechnicalOwner(
  elements: readonly ElementsHeadRow[],
  capabilities: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  ownsEdges: readonly RelationshipsHeadRow[],
): ElementsHeadRow[] {
  const essentialFunctionIds = new Set(capabilities.filter((c) => attributesRecord(c.attributes).essentialFunction === true).map((c) => c.element_id));
  if (essentialFunctionIds.size === 0) return [];
  const supportingElementIds = new Set(supportsEdges.filter((edge) => essentialFunctionIds.has(edge.to_element_id)).map((edge) => edge.from_element_id));
  const technicallyOwnedIds = new Set(ownsEdges.filter((edge) => attributesRecord(edge.attributes).role === 'technical').map((edge) => edge.to_element_id));
  return elements.filter((element) => supportingElementIds.has(element.element_id) && !technicallyOwnedIds.has(element.element_id));
}

/**
 * Prompt 7k item 5's third Assurance finding: "critical systems past or
 * within 12 months of vendor support end" — a system-level check against
 * `supportEndsAt`, deliberately distinct from `findCriticalExposedSystems`
 * above, which reads `plannedEnd` (this estate's own decommission date, not
 * the vendor's support horizon). Same `monthsUntil`/`STALE_AFTER_MONTHS`
 * shape: negative once the date is in the past, so an already-lapsed
 * support date reads as exposed too, not less so.
 */
export function findCriticalSystemsPastOrNearSupportEnd(systems: readonly ElementsHeadRow[], now: Date = new Date()): ElementsHeadRow[] {
  return systems.filter((system) => {
    const attrs = attributesRecord(system.attributes);
    if (attrs.criticality !== 'critical') return false;
    const supportEndsAtValue = attrs.supportEndsAt;
    if (typeof supportEndsAtValue !== 'string') return false;
    const supportEndsAt = new Date(supportEndsAtValue);
    if (Number.isNaN(supportEndsAt.getTime())) return false;
    return monthsUntil(supportEndsAt, now) <= STALE_AFTER_MONTHS;
  });
}

/**
 * F11 (ADR-001 "Amended (Disposition, TIME)"): systems and modules whose own
 * recorded disposition is Migrate or Eliminate, with no open change retiring
 * them — a recorded intention with no work behind it. "Retiring" means an
 * open change retracts the element or sets its lifecycle to retiring or
 * retired (`retiringElementIds`, `loadElementsRetiredByOpenChanges`). Also
 * skipped when main already shows it retiring or retired (a module reads its
 * platform's lifecycle when it has none of its own) — that work is done or
 * under way. A module's disposition is its own, never its platform's.
 */
export function findOutgoingWithoutRetiringChange(elements: readonly ElementsHeadRow[], retiringElementIds: ReadonlySet<UUID>, elementsById: ReadonlyMap<UUID, ElementsHeadRow> = new Map()): ElementsHeadRow[] {
  return elements.filter((element) => {
    if (element.element_type !== 'system' && element.element_type !== 'container') return false;
    const attrs = attributesRecord(element.attributes);
    if (attrs.disposition !== 'migrate' && attrs.disposition !== 'eliminate') return false;
    if (retiringElementIds.has(element.element_id)) return false;
    const parent = element.parent_id !== null ? elementsById.get(element.parent_id) : undefined;
    const lifecycle = typeof attrs.lifecycleStatus === 'string' ? attrs.lifecycleStatus : parent ? attributesRecord(parent.attributes).lifecycleStatus : undefined;
    return lifecycle !== 'retiring' && lifecycle !== 'retired';
  });
}

/** F11: the change statuses still open (`atlas.branch_status_is_open`) — a fixed, small enum, safe in an `.in()` filter. */
const OPEN_CHANGE_STATUSES = ['draft', 'proposed', 'in_review', 'approved'] as const;

/**
 * F11: every element an open change retires — retracts it, or sets its
 * lifecycle to retiring/retired. One delta query per open change, filtered
 * by `commits.branch_id` through an inner embed and routed through
 * `selectAll` (SPEC §6.7) — never an `.in()` over a growing id list
 * (CLAUDE.md rule 8). RLS applies: another member's unshared draft is
 * invisible, so its retirement doesn't count here.
 */
export async function loadElementsRetiredByOpenChanges(supabase: Client, modelId: UUID): Promise<Set<UUID>> {
  interface RetiringDeltaRow { subject_id: UUID; kind: string; attribute: string | null; value: unknown }
  const { data, error } = await supabase.from('branches').select('id').eq('model_id', modelId).eq('kind', 'change').in('status', [...OPEN_CHANGE_STATUSES]);
  if (error) throw new Error(`loadElementsRetiredByOpenChanges: ${error.message}`);
  const retiring = new Set<UUID>();
  for (const branch of data as { id: UUID }[]) {
    const rows = await selectAll<RetiringDeltaRow>(
      supabase
        .from('deltas')
        .select('id, subject_id, kind, attribute, value, commits!inner(branch_id)', { count: 'exact' })
        .eq('model_id', modelId)
        .eq('subject_type', 'element')
        .eq('commits.branch_id', branch.id)
        .order('id'),
    );
    for (const row of rows) {
      if (row.kind === 'element_retract') retiring.add(row.subject_id);
      else if (row.kind === 'element_update' && row.attribute === 'lifecycleStatus' && (row.value === 'retiring' || row.value === 'retired')) retiring.add(row.subject_id);
    }
  }
  return retiring;
}

/** F11: an open project whose declared scope includes an element — the finding names it, and its row opens it rather than starting another. */
export interface ElementProjectScope {
  elementId: UUID;
  projectId: UUID;
  projectTitle: string;
}

/** F11: declared-scope links of the model's open (active/on-hold) projects, through one inner embed on `projects.model_id` — no id list. */
export async function listOpenProjectScopeForModel(supabase: Client, modelId: UUID): Promise<ElementProjectScope[]> {
  interface EmbeddedProject { id: UUID; title: string; status: string }
  // A many-to-one embed returns one object at runtime; postgrest-js's
  // inference types it as an array, so accept either.
  const rows = await selectAll<{ linked_id: UUID; projects: EmbeddedProject | EmbeddedProject[] }>(
    supabase
      .from('project_links')
      .select('linked_id, project_id, linked_type, projects!inner(id, title, status, model_id)', { count: 'exact' })
      .eq('linked_type', 'element')
      .eq('projects.model_id', modelId)
      .order('project_id')
      .order('linked_id'),
  );
  return rows.flatMap((r) => {
    const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    if (!project || (project.status !== 'active' && project.status !== 'on_hold')) return [];
    return [{ elementId: r.linked_id, projectId: project.id, projectTitle: project.title }];
  });
}

/** Plan A1b ("a project must name a capability"): one open project whose declared scope names no capability — its one action opens the project, where the derived capabilities can be added in one click. */
export interface ProjectWithoutCapability {
  projectId: UUID;
  projectTitle: string;
}

/**
 * Plan A1b's own finding, the Home half: open (active/on-hold) projects
 * whose declared element-scope includes no capability — the gap A1a's
 * "Start a project" form guard now prevents at creation, surfaced for
 * projects made before it (or ones a capability was later removed from).
 * A project reaches this finding only through its own scope links, so a
 * project with no scope at all is not flagged here — there is nothing to
 * derive a capability from, and A1a already stops a new project starting
 * empty; the project page's own prompt is where a missing capability gets
 * added, derived or by hand. Pure over the scope rows
 * (`listOpenProjectScopeForModel`) and the model's elements, so the same
 * `elementsById` the other findings already build decides a link's type —
 * no extra query. One row per project, in first-seen project order; a
 * project's rows keep the scope query's own `project_id, linked_id`
 * ordering.
 */
export function findProjectsWithoutCapability(
  projectScope: readonly ElementProjectScope[],
  elementsById: ReadonlyMap<UUID, ElementsHeadRow>,
): ProjectWithoutCapability[] {
  const byProject = new Map<UUID, { title: string; hasCapability: boolean }>();
  for (const row of projectScope) {
    const isCapability = elementsById.get(row.elementId)?.element_type === 'capability';
    const existing = byProject.get(row.projectId);
    if (existing) existing.hasCapability = existing.hasCapability || isCapability;
    else byProject.set(row.projectId, { title: row.projectTitle, hasCapability: isCapability });
  }
  const findings: ProjectWithoutCapability[] = [];
  for (const [projectId, { title, hasCapability }] of byProject) {
    if (!hasCapability) findings.push({ projectId, projectTitle: title });
  }
  return findings;
}

/**
 * Plan A1b's project-page half: the capabilities a scope-less project could
 * adopt in one click, derived from the capabilities its own scoped systems
 * and modules already support (existing `supports` edges only — `from` is
 * the supporter, `to` the capability). Deduped and name-resolved, in the
 * order each is first reached walking the scoped systems; a candidate
 * already in scope, or one that is no longer a live capability, is left
 * out. Pure — the caller fetches the scoped systems' `supports` edges
 * (`listSupportsEdgesForSystems`) and resolves the capability names.
 */
export function deriveCapabilitiesForScope(
  scopeIds: readonly UUID[],
  supportsEdges: readonly RelationshipsHeadRow[],
  elementsById: ReadonlyMap<UUID, ElementsHeadRow>,
): { id: UUID; name: string }[] {
  const scopeSet = new Set(scopeIds);
  const supporterIds = new Set(
    scopeIds.filter((id) => {
      const type = elementsById.get(id)?.element_type;
      return type === 'system' || type === 'container';
    }),
  );
  const derived: { id: UUID; name: string }[] = [];
  const seen = new Set<UUID>();
  for (const edge of supportsEdges) {
    if (!supporterIds.has(edge.from_element_id)) continue;
    const capId = edge.to_element_id;
    if (seen.has(capId) || scopeSet.has(capId)) continue;
    const cap = elementsById.get(capId);
    if (cap?.element_type !== 'capability') continue;
    seen.add(capId);
    derived.push({ id: capId, name: cap.name });
  }
  return derived;
}

/**
 * A decision-shaped finding (architect-door per-item-action prompt):
 * level-1 capabilities with zero supporting systems anywhere in their own
 * subtree. Reuses `computeCapabilityRollup` (`src/ui/capabilityMap/
 * capabilityRollup.ts`) rather than a bare "no direct supports edge" check
 * — a parent capability routinely carries no *direct* edge of its own
 * because everything attaches to its children, so a direct-edge-only
 * check would misname most well-supported parents as unsupported. This is
 * the exact same classification the director door's own weak-capability
 * grid already flags as "nothing recorded" (`buildCapabilityTiles`,
 * `src/db/modelHome.ts`, `tone: 'neutral'` when `supportingSystems.length
 * === 0`) — named here as its own architect-door finding rather than a
 * second, driftable definition of the same gap. Since 2026-10-03 the
 * Home finding itself is gone (Overview's grid is its one home,
 * UI-principles §3); this function backs the Elements browse table's
 * `capability-no-supporters` filter.
 */
export function findCapabilitiesWithNoSupporters(
  level1Capabilities: readonly ElementsHeadRow[],
  allCapabilities: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  ownsEdges: readonly RelationshipsHeadRow[],
): ElementsHeadRow[] {
  const capabilitiesById = new Map(allCapabilities.map((c) => [c.element_id, c]));
  const selfOwnedIds = computeSelfOwnedCapabilityIds(allCapabilities, supportsEdges, ownsEdges);
  return level1Capabilities.filter((capability) => computeCapabilityRollup(capability, allCapabilities, capabilitiesById, supportsEdges, selfOwnedIds).supportingSystemIds.length === 0);
}

export { STALE_AFTER_MONTHS };
