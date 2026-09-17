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
import type { SystemDomain, UUID } from '../contracts/delta';
import { computeCapabilityRollup } from '../ui/capabilityMap/capabilityRollup';
import { attributesRecord } from '../ui/elements/attributesRecord';
import { isFitForPurpose } from '../ui/elements/fitForPurposeTone';
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
  fromName: string;
  toName: string;
  fromDomain: SystemDomain;
  toDomain: SystemDomain;
  /** No verb-phrase label recorded — the same "empty/missing description" check `findUnlabeledVerbRelationships` already uses. */
  missingVerb: boolean;
  /** Only ever `true` for a `flows_to` edge — a `uses` edge has no `dataClassification` attribute to be missing, so it's always `false` here (this crossing is only ever flagged for a missing verb, never for a fact `uses` was never going to carry). */
  missingDataClassification: boolean;
}

/** One domain is `'it'` and the other `'ot'` — `'hybrid'` never participates on either side (ambiguous by construction: a hybrid endpoint isn't clearly on one side of the boundary or the other), Prompt 7k item 3's own judgment call for what counts as a "crossing" at all. */
function isBoundaryCrossingPair(a: SystemDomain, b: SystemDomain): boolean {
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

    result.push({ relationshipId: edge.relationship_id, relationshipType: edge.relationship_type, fromName: from.name, toName: to.name, fromDomain, toDomain, missingVerb, missingDataClassification });
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
    result.push({ relationshipId: edge.relationship_id, relationshipType: edge.relationship_type, fromName: from.name, toName: to.name });
  }
  return result;
}

export interface ExternalOrganisationAccess {
  relationshipId: UUID;
  organisation: string;
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
    result.push({ relationshipId: edge.relationship_id, organisation, systemName: target.name });
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
export function findUnusedIntegrationPlatforms(systems: readonly ElementsHeadRow[], usesAndFlowsToEdges: readonly RelationshipsHeadRow[]): ElementsHeadRow[] {
  const platformIdsInUse = new Set<UUID>();
  for (const edge of usesAndFlowsToEdges) {
    const via = attributesRecord(edge.attributes).via;
    if (typeof via === 'string') platformIdsInUse.add(via);
  }
  return systems.filter((system) => attributesRecord(system.attributes).kind === 'integration_platform' && !platformIdsInUse.has(system.element_id));
}

/** Every fact at `commitId`, unfiltered by subject — callers scope to the systems they care about (health findings only reads systems' own attributes, not every subject in the model). Routed through `selectAll` (SPEC §6.7): `facts` is one of the tables `max_rows` can silently truncate. */
export async function listFactsForCommit(supabase: Client, commitId: string): Promise<FactsRow[]> {
  const query = supabase.from('facts').select('*', { count: 'exact' }).eq('commit_id', commitId).order('subject_id').order('attribute');
  return selectAll<FactsRow>(query);
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
): ElementsHeadRow[] {
  const linkedElementIds = new Set(supportsEdges.map((edge) => edge.from_element_id));
  const modulesByPlatformId = groupModulesByPlatformId(containers);
  return systems.filter((system) => {
    if (isPlatform(system)) {
      const modules = modulesByPlatformId.get(system.element_id);
      if (modules && modules.length > 0) return !modules.some((module) => linkedElementIds.has(module.element_id));
    }
    return !linkedElementIds.has(system.element_id);
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

/**
 * Prompt 7k item 5's first Assurance finding: "systems supporting an
 * essential function without a technical owner" — NIS essential functions
 * are recorded at capability level (`CapabilityAttributes.essentialFunction`)
 * and derived down to systems through `supports`, the same rollup shape
 * `computeSelfOwnedCapabilityIds` above already uses in the other direction
 * (capability ownership derived from a supporting system's `owns` edge).
 * "Technical owner" reuses `findSystemsWithoutTechnicalOwner`'s own
 * `role: 'technical'` definition, scoped down to just the systems this
 * finding cares about.
 */
export function findSystemsSupportingEssentialFunctionWithoutTechnicalOwner(
  systems: readonly ElementsHeadRow[],
  capabilities: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  ownsEdges: readonly RelationshipsHeadRow[],
): ElementsHeadRow[] {
  const essentialFunctionIds = new Set(capabilities.filter((c) => attributesRecord(c.attributes).essentialFunction === true).map((c) => c.element_id));
  if (essentialFunctionIds.size === 0) return [];
  const supportingSystemIds = new Set(supportsEdges.filter((edge) => essentialFunctionIds.has(edge.to_element_id)).map((edge) => edge.from_element_id));
  const technicallyOwnedIds = new Set(ownsEdges.filter((edge) => attributesRecord(edge.attributes).role === 'technical').map((edge) => edge.to_element_id));
  return systems.filter((system) => supportingSystemIds.has(system.element_id) && !technicallyOwnedIds.has(system.element_id));
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
 * The minimal fit-for-purpose finding: capabilities whose *primary*
 * supporter (`SupportsAttributes.role === 'primary'`, `SupportsRole`'s own
 * doc comment) is rated `poor` or `adequate`
 * (`src/ui/elements/fitForPurposeTone.ts`'s `isFitForPurpose`), with no
 * planned replacement recorded for that supporter — a third "Start a
 * decision" trigger alongside `findCriticalSystemsPastOrNearSupportEnd` (a
 * system's own vendor support horizon) and the director door's
 * weak-capability tile (`DirectorHome.tsx`'s "no known supporters" case,
 * `prefillFromWeakCapability`).
 *
 * `role: 'primary'` is a per-*system* cardinality rule (`SupportsRole`'s
 * own doc comment: at most one live primary edge per system, "which
 * capability lane a system's landscape tile sits in"), not a per-capability
 * one — nothing in `relationship_type_rules` stops two different systems
 * from each naming `primary` toward the *same* capability, so every
 * matching edge is checked here, not just the first found; a capability is
 * flagged the moment any one of them qualifies.
 *
 * `plannedReplacementSystemIdsByCapability` is
 * `src/db/modelHome.ts`'s `groupPlannedReplacementsByCapability` result —
 * the same real "no planned replacement" evidence `computeExposureTone`
 * already consults for Lifecycle Exposure, not a second, weaker
 * approximation of it.
 */
export function findCapabilitiesWithPoorFitPrimarySupporter(
  capabilities: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  plannedReplacementSystemIdsByCapability: ReadonlyMap<UUID, ReadonlySet<UUID>>,
): ElementsHeadRow[] {
  const capabilitiesById = new Map(capabilities.map((c) => [c.element_id, c]));
  const flaggedIds = new Set<UUID>();

  for (const edge of supportsEdges) {
    if (edge.relationship_type !== 'supports') continue;
    const attrs = attributesRecord(edge.attributes);
    if (attrs.role !== 'primary') continue;
    if (typeof attrs.fitForPurpose !== 'string' || !isFitForPurpose(attrs.fitForPurpose)) continue;
    if (attrs.fitForPurpose !== 'poor' && attrs.fitForPurpose !== 'adequate') continue;
    const capability = capabilitiesById.get(edge.to_element_id);
    if (!capability) continue;
    const replacedSystemIds = plannedReplacementSystemIdsByCapability.get(capability.element_id);
    if (replacedSystemIds?.has(edge.from_element_id)) continue;
    flaggedIds.add(capability.element_id);
  }

  return [...flaggedIds]
    .map((id) => capabilitiesById.get(id))
    .filter((c): c is ElementsHeadRow => c !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name) || a.element_id.localeCompare(b.element_id));
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
 * second, driftable definition of the same gap.
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
