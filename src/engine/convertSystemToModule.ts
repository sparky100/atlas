/**
 * "Convert to a module" — a system that turns out to have been built on an
 * existing platform all along (a real import scenario the user described:
 * something identified as a new, standalone system was really one more
 * module of a platform already in the model) becomes a `container` parented
 * on that platform, in one commit.
 *
 * Not covered by ADR-000/SPEC-data-model.md — `elementType` is compile-time
 * immutable (`PromotedElementAttribute` in `src/contracts/delta.ts` only
 * ever promotes `name`/`parentId`; there is no `element.update` path that
 * changes it), and `element_merges` (`mergeElements.ts`) explicitly refuses
 * to merge elements of different types — a system and a container can never
 * be "the same real thing" in that sense. This is a genuinely new
 * operation: retract the system, create a fresh container in its place, and
 * re-point every one of its live relationships onto the new id, all in one
 * commit (C8 order: relationships first, the old element retracted last,
 * exactly `buildMergeElementsDeltas`'s own ordering).
 *
 * Unlike a merge, the new id has never existed before, so none of
 * `buildMergeElementsDeltas`'s three drop cases apply: a brand-new container
 * has no relationships of its own yet to self-loop against, duplicate, or
 * collide with on cardinality (`supports.role`/`owns.role` are anchored on
 * an element id nothing has referenced before this commit) — every live
 * relationship simply carries over with its type and attributes untouched.
 * Every relationship type reachable from/to a `system` already has a
 * `container` equivalent (`RELATIONSHIP_TYPE_RULES`: `supports`, `uses`,
 * `owns` — since the `owns/actor/container` row was added — and `flows_to`
 * all have one), so nothing is ever dropped for lack of a legal triple.
 *
 * No v1 undo (unlike merge's `buildUndoMergeElementsDeltas`) — a genuinely
 * open product question (does undoing restore the exact same container id
 * a later fact might already reference?) left for if this is asked for.
 */
import type { Delta, RelationshipType, SystemAttributes, ContainerAttributes, UUID } from '../contracts/delta';
import type { Json } from '../contracts/rows';
import type { Head } from './deltas';
import { EngineError } from './errors';

/** One of the system's own live relationships, carried over onto the new container id unchanged — the confirmation preview's own input. */
export interface ConvertedRelationship {
  relationshipId: UUID;
  relationshipType: RelationshipType;
  /** The relationship's other endpoint — whichever side wasn't the system being converted. */
  otherElementId: UUID;
  /** Which side of the relationship the system was on. */
  side: 'from' | 'to';
}

export interface BuildConvertSystemToModuleResult {
  deltas: Delta[];
  /** The freshly-minted container's own id — the caller's "just converted" link/highlight, same shape `onCreated` gets elsewhere. */
  newContainerId: UUID;
  /** `SystemAttributes` fields that had a value but have nowhere to go on `ContainerAttributes` — the confirmation UI's own "these facts won't carry over" list. */
  droppedAttributeKeys: string[];
  relationships: ConvertedRelationship[];
}

function elementCreateContainerDelta(id: UUID, elementId: UUID, name: string, parentId: UUID, attributes: ContainerAttributes, sourceId: UUID): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'container', name, parentId, attributes, sourceId, confidence: 1 } as never;
}

function elementRetractSystemDelta(id: UUID, elementId: UUID, previousDeltaId: UUID, sourceId: UUID): Delta {
  return { kind: 'element.retract', id, elementId, elementType: 'system', previousDeltaId, sourceId, confidence: 1 } as never;
}

function relationshipRetractDelta(id: UUID, relationshipId: UUID, relationshipType: RelationshipType, previousDeltaId: UUID, sourceId: UUID): Delta {
  return { kind: 'relationship.retract', id, relationshipId, relationshipType, previousDeltaId, sourceId, confidence: 1 } as never;
}

function relationshipCreateDelta(id: UUID, relationshipId: UUID, relationshipType: RelationshipType, fromElementId: UUID, toElementId: UUID, attributes: Record<string, Json>, sourceId: UUID): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType, fromElementId, toElementId, attributes, sourceId, confidence: 1 } as never;
}

/**
 * `SystemAttributes` keys `ContainerAttributes` has no field for at all
 * (`vendor`, `externalOrganisation`, `kind`) — real facts
 * that simply don't carry over, surfaced here rather than silently dropped
 * (CLAUDE.md rule 7). Every other `SystemAttributes` field (`description`,
 * `isExternal`, `introduced`, `plannedEnd`, `supportEndsAt`, `criticality`, `annualRunCost`,
 * `hostingModel`, `hostingProvider`, `domain`, `lifecycleStatus`, `version`)
 * has a same-named `ContainerAttributes` field and carries straight over.
 */
const SYSTEM_ONLY_ATTRIBUTE_KEYS = ['vendor', 'externalOrganisation', 'kind'] as const satisfies readonly (keyof SystemAttributes)[];

function containerAttributesFromSystem(systemAttributes: SystemAttributes): { attributes: ContainerAttributes; droppedAttributeKeys: string[] } {
  const attributes: ContainerAttributes = { isExternal: systemAttributes.isExternal };
  if (systemAttributes.description !== undefined) attributes.description = systemAttributes.description;
  if (systemAttributes.introduced !== undefined) attributes.introduced = systemAttributes.introduced;
  if (systemAttributes.plannedEnd !== undefined) attributes.plannedEnd = systemAttributes.plannedEnd;
  if (systemAttributes.supportEndsAt !== undefined) attributes.supportEndsAt = systemAttributes.supportEndsAt;
  if (systemAttributes.criticality !== undefined) attributes.criticality = systemAttributes.criticality;
  // The system's own avoidable run cost is the same software's avoidable
  // run cost after conversion — it carries over as the module's own value
  // (recorded decision: it is NOT inherited *from* a platform the other way
  // round, `ContainerAttributes.annualRunCost`'s doc comment).
  if (systemAttributes.annualRunCost !== undefined) attributes.annualRunCost = systemAttributes.annualRunCost;
  // F11: the same software's disposition carries over too (ADR-001 amendment).
  if (systemAttributes.disposition !== undefined) attributes.disposition = systemAttributes.disposition;
  // Product vs custom build carries over too: the same software's sourcing.
  if (systemAttributes.sourcing !== undefined) attributes.sourcing = systemAttributes.sourcing;
  if (systemAttributes.hostingModel !== undefined) attributes.hostingModel = systemAttributes.hostingModel;
  if (systemAttributes.hostingProvider !== undefined) attributes.hostingProvider = systemAttributes.hostingProvider;
  if (systemAttributes.domain !== undefined) attributes.domain = systemAttributes.domain;
  // `lifecycleStatus` is required on `SystemAttributes` (unlike every other
  // field here) but only optional on `ContainerAttributes` — always carries
  // over, never conditionally.
  attributes.lifecycleStatus = systemAttributes.lifecycleStatus;
  if (systemAttributes.version !== undefined) attributes.version = systemAttributes.version;

  const droppedAttributeKeys = SYSTEM_ONLY_ATTRIBUTE_KEYS.filter((key) => systemAttributes[key] !== undefined);
  return { attributes, droppedAttributeKeys };
}

/**
 * Builds the one commit's worth of deltas: a new container (parented on
 * `targetPlatformId`, carrying over every attribute `ContainerAttributes`
 * has room for), every one of `systemId`'s own live relationships re-
 * pointed onto it, and `systemId` itself retracted last (C8). `targetPlatformId`
 * only needs to be a live `system` (V2's own structural requirement for a
 * container's parent) — not specifically `kind: 'platform'`, the same "no
 * parent-kind invariant" stance `RELATIONSHIP_TYPE_RULES`'s own
 * `supports(container, capability)` amendment already takes; a caller-side
 * picker is free to scope its own search to platforms without the engine
 * enforcing it.
 *
 * Refuses when `systemId` already has live children of its own (any element
 * whose `parentId` is `systemId`) — those children's own `parentId` would
 * then point at a `container`, which V2 never allows (only `system` is a
 * legal container parent); converting a platform that already has modules
 * of its own is out of scope for this operation, not silently broken.
 */
export function buildConvertSystemToModuleDeltas(head: Head, systemId: UUID, targetPlatformId: UUID, sourceId: UUID, mintId: () => UUID): BuildConvertSystemToModuleResult {
  if (systemId === targetPlatformId) throw new EngineError('convertSystemToModule: cannot convert a system into a module of itself');
  const system = head.elements.get(systemId);
  if (!system) throw new EngineError(`convertSystemToModule: ${systemId} does not exist in this head`);
  // system-only: only a whole system can be converted into a module.
  if (system.elementType !== 'system') throw new EngineError(`convertSystemToModule: ${systemId} is a ${system.elementType}, not a system`);
  const targetPlatform = head.elements.get(targetPlatformId);
  if (!targetPlatform) throw new EngineError(`convertSystemToModule: target platform ${targetPlatformId} does not exist in this head`);
  // system-only: a module sits inside a platform, which is a whole system.
  if (targetPlatform.elementType !== 'system') throw new EngineError(`convertSystemToModule: target platform ${targetPlatformId} is a ${targetPlatform.elementType}, not a system`);

  for (const [, element] of head.elements) {
    if (element.parentId === systemId) {
      throw new EngineError(`convertSystemToModule: ${systemId} already has its own children — converting a platform with modules is not supported`);
    }
  }

  const { attributes, droppedAttributeKeys } = containerAttributesFromSystem(system.attributes as unknown as SystemAttributes);
  const newContainerId = mintId();
  const deltas: Delta[] = [elementCreateContainerDelta(mintId(), newContainerId, system.name, targetPlatformId, attributes, sourceId)];

  const relationships: ConvertedRelationship[] = [];
  for (const [relId, rel] of head.relationships) {
    if (rel.fromElementId !== systemId && rel.toElementId !== systemId) continue;
    const side: 'from' | 'to' = rel.fromElementId === systemId ? 'from' : 'to';
    const otherElementId = side === 'from' ? rel.toElementId : rel.fromElementId;

    deltas.push(relationshipRetractDelta(mintId(), relId, rel.relationshipType, rel.existsDeltaId, sourceId));

    const newFrom = side === 'from' ? newContainerId : rel.fromElementId;
    const newTo = side === 'to' ? newContainerId : rel.toElementId;
    deltas.push(relationshipCreateDelta(mintId(), mintId(), rel.relationshipType, newFrom, newTo, { ...rel.attributes }, sourceId));
    relationships.push({ relationshipId: relId, relationshipType: rel.relationshipType, otherElementId, side });
  }

  deltas.push(elementRetractSystemDelta(mintId(), systemId, system.existsDeltaId, sourceId));

  return { deltas, newContainerId, droppedAttributeKeys, relationships };
}
