/**
 * "Export everything (JSON)": one file holding the whole model as of one
 * commit — every element, every relationship (all types, including
 * `replaces`), every attribute value with where it came from, the sources
 * those facts cite, and the custom attribute definitions. A backup and
 * analysis format: it is deliberately not the import file's shape (that
 * can only carry systems, modules, uses/flows links and retirements), so
 * nothing here is lost to what the importer can read.
 *
 * Pure — the loader (`useElementExport.ts`) fetches, this only shapes.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { GoalCapabilityRow, GoalRow } from '../../contracts/goals';
import type { AttributeDefinitionRow, SourceRow } from '../../db/types';

export const MODEL_SNAPSHOT_FORMAT = 'atlas-model-export';
export const MODEL_SNAPSHOT_VERSION = 1;

export interface ModelSnapshotInput {
  modelId: UUID;
  modelName: string;
  commitId: UUID;
  exportedAt: Date;
  elements: readonly ElementsHeadRow[];
  relationships: readonly RelationshipsHeadRow[];
  facts: readonly FactsRow[];
  sources: readonly SourceRow[];
  definitions: readonly AttributeDefinitionRow[];
  /** ADR-035: the model's goals and which capabilities serve each. Workflow records as they stand now, not as of `commitId`. Omitted means none. */
  goals?: readonly GoalRow[];
  goalLinks?: readonly GoalCapabilityRow[];
}

export interface ModelSnapshot {
  format: typeof MODEL_SNAPSHOT_FORMAT;
  version: typeof MODEL_SNAPSHOT_VERSION;
  exportedAt: string;
  model: { id: UUID; name: string };
  /** The commit this snapshot reads — the model as it stood then. */
  asOfCommit: UUID;
  elements: {
    id: UUID;
    type: string;
    name: string;
    parentId: UUID | null;
    parentName: string | null;
    attributes: unknown;
  }[];
  relationships: {
    id: UUID;
    type: string;
    fromId: UUID;
    fromName: string | null;
    toId: UUID;
    toName: string | null;
    attributes: unknown;
  }[];
  /** Where each recorded value came from: one row per subject and attribute. */
  provenance: {
    subjectType: string;
    subjectId: UUID;
    attribute: string;
    value: unknown;
    sourceId: UUID;
    sourceRef: string | null;
    confidence: number;
    effectiveDate: string | null;
    assertedAt: string;
  }[];
  sources: { id: UUID; kind: string; name: string; uri: string | null; capturedAt: string | null; createdAt: string }[];
  /** ADR-035: goals as they stand now (they are not part of any commit), each with the capabilities that serve it. */
  goals: { id: UUID; title: string; statement: string; whyNow: string; status: string; capabilities: { id: UUID; name: string | null }[] }[];
  attributeDefinitions: { key: string; label: string; kind: string; options: readonly string[] | null; appliesTo: readonly string[]; required: boolean; description: string | null; deprecated: boolean }[];
}

export function buildModelSnapshot(input: ModelSnapshotInput): ModelSnapshot {
  const nameById = new Map(input.elements.map((e) => [e.element_id, e.name]));
  const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return {
    format: MODEL_SNAPSHOT_FORMAT,
    version: MODEL_SNAPSHOT_VERSION,
    exportedAt: input.exportedAt.toISOString(),
    model: { id: input.modelId, name: input.modelName },
    asOfCommit: input.commitId,
    elements: [...input.elements]
      .sort((a, b) => byName(a.element_type, b.element_type) || byName(a.name, b.name) || byName(a.element_id, b.element_id))
      .map((e) => ({ id: e.element_id, type: e.element_type, name: e.name, parentId: e.parent_id, parentName: e.parent_id !== null ? (nameById.get(e.parent_id) ?? null) : null, attributes: e.attributes })),
    relationships: [...input.relationships]
      .sort((a, b) => byName(a.relationship_type, b.relationship_type) || byName(a.relationship_id, b.relationship_id))
      .map((r) => ({ id: r.relationship_id, type: r.relationship_type, fromId: r.from_element_id, fromName: nameById.get(r.from_element_id) ?? null, toId: r.to_element_id, toName: nameById.get(r.to_element_id) ?? null, attributes: r.attributes })),
    provenance: [...input.facts]
      .sort((a, b) => byName(a.subject_id, b.subject_id) || byName(a.attribute, b.attribute))
      .map((f) => ({ subjectType: f.subject_type, subjectId: f.subject_id, attribute: f.attribute, value: f.value, sourceId: f.source_id, sourceRef: f.source_ref, confidence: f.confidence, effectiveDate: f.effective_date, assertedAt: f.asserted_at })),
    sources: [...input.sources].sort((a, b) => byName(a.id, b.id)).map((s) => ({ id: s.id, kind: s.kind, name: s.name, uri: s.uri, capturedAt: s.captured_at, createdAt: s.created_at })),
    goals: [...(input.goals ?? [])]
      .sort((a, b) => byName(a.title, b.title) || byName(a.id, b.id))
      .map((g) => ({
        id: g.id,
        title: g.title,
        statement: g.statement,
        whyNow: g.why_now,
        status: g.status,
        capabilities: (input.goalLinks ?? [])
          .filter((l) => l.goal_id === g.id)
          .map((l) => ({ id: l.capability_id, name: nameById.get(l.capability_id) ?? null }))
          .sort((a, b) => byName(a.name ?? '', b.name ?? '') || byName(a.id, b.id)),
      })),
    attributeDefinitions: [...input.definitions]
      .sort((a, b) => a.order_index - b.order_index || byName(a.key, b.key))
      .map((d) => ({ key: d.key, label: d.label, kind: d.kind, options: d.options, appliesTo: d.applies_to, required: d.required, description: d.description, deprecated: d.deprecated_at !== null })),
  };
}
