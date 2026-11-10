/**
 * "Copy this model" (docs/ADR-030-copy-model.md): turns the current head of
 * one model into the deltas of ONE new `manual` commit in another, with fresh
 * element/relationship/delta ids. Pure, no I/O — `src/db/copyModel.ts` reads
 * the source head, calls this, folds the result, and hands it to
 * `atlas.copy_model`, which enforces owner-only and writes it atomically.
 *
 * Provenance is preserved, not replaced (rule 4): every copied fact keeps its
 * original source, source reference, effective date and confidence. A delta
 * carries one provenance, so an element's `create` takes the provenance of its
 * `$exists` fact, and any other fact whose provenance differs from that gets
 * its own follow-up update delta. Retracted elements/relationships are not in
 * the head and are not copied (version history is out of scope).
 *
 * Ids come from the injected `mintId`, never `Math.random` (rule 6); the
 * element order is parent-first and then by id, so the same head and the same
 * minter always give the same deltas.
 */
import { isCoreAttributeKey } from '../contracts/attributeSchema';
import { EXISTS_ATTRIBUTE, type Delta, type Json, type UUID } from '../contracts/delta';
import { factMapKey, type ElementRow, type FactRow, type Head } from './deltas';

/** Relationship attribute keys that are part of the schema (src/contracts/delta.ts's `*Attributes`); anything else is an org-defined custom attribute. */
const RELATIONSHIP_CORE_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  'description',
  'role',
  'primary',
  'fitForPurpose',
  'fitForPurposeNotes',
  'protocol',
  'protocolIn',
  'protocolOut',
  'dataClassification',
  'via',
]);

export interface CopyPlan {
  deltas: Delta[];
  /** old element id → new element id, for re-pointing aliases and source touch lists. */
  elementIdMap: Map<UUID, UUID>;
  relationshipIdMap: Map<UUID, UUID>;
  /** Every source id the copied facts name (old ids) — the caller re-keys exactly these. */
  sourceIds: Set<UUID>;
}

function sameProvenance(a: FactRow, b: FactRow): boolean {
  return a.sourceId === b.sourceId && a.confidence === b.confidence && (a.sourceRef ?? null) === (b.sourceRef ?? null) && (a.effectiveDate ?? null) === (b.effectiveDate ?? null);
}

function provenanceOf(fact: FactRow, sourceIdMap: ReadonlyMap<UUID, UUID>): { sourceId: UUID; confidence: number; sourceRef?: string; effectiveDate?: string } {
  const sourceId = sourceIdMap.get(fact.sourceId);
  if (!sourceId) throw new Error(`buildCopyPlan: no new id for source ${fact.sourceId}`);
  return {
    sourceId,
    confidence: fact.confidence,
    ...(fact.sourceRef !== undefined ? { sourceRef: fact.sourceRef } : {}),
    ...(fact.effectiveDate !== undefined ? { effectiveDate: fact.effectiveDate } : {}),
  };
}

/** Parents before children (a stage needs its stream, a container its system), ties broken by id for determinism. */
function elementsParentFirst(head: Head): [UUID, ElementRow][] {
  const ids = [...head.elements.keys()].sort();
  const done = new Set<UUID>();
  const ordered: [UUID, ElementRow][] = [];
  const visit = (id: UUID, trail: Set<UUID>) => {
    if (done.has(id)) return;
    const row = head.elements.get(id);
    if (!row) return;
    if (trail.has(id)) throw new Error(`buildCopyPlan: element ${id} is its own ancestor`);
    trail.add(id);
    if (row.parentId !== null) visit(row.parentId, trail);
    trail.delete(id);
    done.add(id);
    ordered.push([id, row]);
  };
  for (const id of ids) visit(id, new Set());
  return ordered;
}

export function buildCopyPlan(head: Head, sourceIdMap: ReadonlyMap<UUID, UUID>, mintId: () => UUID): CopyPlan {
  const elementIdMap = new Map<UUID, UUID>();
  const relationshipIdMap = new Map<UUID, UUID>();
  const sourceIds = new Set<UUID>();
  const deltas: Delta[] = [];

  const exists = (subjectId: UUID): FactRow => {
    const fact = head.facts.get(factMapKey(subjectId, EXISTS_ATTRIBUTE));
    if (!fact) throw new Error(`buildCopyPlan: ${subjectId} has no $exists fact`);
    return fact;
  };
  const otherFacts = (subjectId: UUID): FactRow[] =>
    [...head.facts.values()].filter((f) => f.subjectId === subjectId && f.attribute !== EXISTS_ATTRIBUTE).sort((a, b) => (a.attribute < b.attribute ? -1 : 1));

  const ordered = elementsParentFirst(head);
  for (const [oldId] of ordered) elementIdMap.set(oldId, mintId());

  for (const [oldId, row] of ordered) {
    const newId = elementIdMap.get(oldId);
    if (!newId) throw new Error('buildCopyPlan: unreachable — id not minted');
    const base = exists(oldId);
    sourceIds.add(base.sourceId);
    const createId = mintId();
    const parentId = row.parentId === null ? null : (elementIdMap.get(row.parentId) ?? null);
    if (row.parentId !== null && parentId === null) throw new Error(`buildCopyPlan: element ${oldId} names parent ${row.parentId}, which is not in the head`);
    deltas.push({
      kind: 'element.create',
      id: createId,
      elementId: newId,
      elementType: row.elementType,
      name: row.name,
      parentId,
      attributes: { ...row.attributes },
      ...provenanceOf(base, sourceIdMap),
    } as Delta);

    for (const fact of otherFacts(oldId)) {
      if (sameProvenance(fact, base)) continue;
      sourceIds.add(fact.sourceId);
      let value: Json | null = fact.value;
      if (fact.attribute === 'parentId') value = parentId;
      const common = { id: mintId(), elementId: newId, elementType: row.elementType, previousDeltaId: createId, ...provenanceOf(fact, sourceIdMap) };
      if (fact.attribute === 'name' || fact.attribute === 'parentId' || isCoreAttributeKey(fact.attribute)) {
        deltas.push({ kind: 'element.update', attribute: fact.attribute, value, ...common } as Delta);
      } else {
        deltas.push({ kind: 'element.update_custom', attribute: fact.attribute, value, ...common });
      }
    }
  }

  const relationships = [...head.relationships.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [oldId] of relationships) relationshipIdMap.set(oldId, mintId());

  const remapVia = (attrs: Record<string, Json>): Record<string, Json> => {
    if (typeof attrs.via !== 'string') return attrs;
    const via = elementIdMap.get(attrs.via);
    const next = { ...attrs };
    if (via) next.via = via;
    else Reflect.deleteProperty(next, 'via');
    return next;
  };

  for (const [oldId, row] of relationships) {
    const newId = relationshipIdMap.get(oldId);
    const from = elementIdMap.get(row.fromElementId);
    const to = elementIdMap.get(row.toElementId);
    if (!newId || !from || !to) throw new Error(`buildCopyPlan: relationship ${oldId} references an element that is not in the head`);
    const base = exists(oldId);
    sourceIds.add(base.sourceId);
    const createId = mintId();
    deltas.push({
      kind: 'relationship.create',
      id: createId,
      relationshipId: newId,
      relationshipType: row.relationshipType,
      fromElementId: from,
      toElementId: to,
      attributes: remapVia({ ...row.attributes }),
      ...provenanceOf(base, sourceIdMap),
    } as Delta);

    for (const fact of otherFacts(oldId)) {
      if (sameProvenance(fact, base)) continue;
      sourceIds.add(fact.sourceId);
      let value: Json | null = fact.value;
      if (fact.attribute === 'via' && typeof value === 'string') value = elementIdMap.get(value) ?? null;
      const common = { id: mintId(), relationshipId: newId, relationshipType: row.relationshipType, previousDeltaId: createId, ...provenanceOf(fact, sourceIdMap) };
      deltas.push({ kind: RELATIONSHIP_CORE_ATTRIBUTE_KEYS.has(fact.attribute) ? 'relationship.update' : 'relationship.update_custom', attribute: fact.attribute, value, ...common } as Delta);
    }
  }

  return { deltas, elementIdMap, relationshipIdMap, sourceIds };
}
