/**
 * Sample models (docs/ADR-033): turns a model's head into a publishable
 * payload, and a published payload into the one commit that copies it into a
 * new model. Pure, no I/O — `src/db/sampleModels.ts` reads and writes.
 *
 * Publishing scrubs what must not leave the organisation it came from: no
 * person's id (a fact's `asserted_by` becomes the nil id), no link out (a
 * source's `uri` becomes null), and no capture-job or person link on a source.
 * Copying reuses `buildCopyPlan` (ADR-030) unchanged, so every copied fact keeps
 * its original source, reference, date and confidence (rule 4); ids come from
 * the injected `mintId`, never `Math.random` (rule 6).
 */
import type { SampleAlias, SamplePayload, SampleSource } from '../contracts/sampleModel';
import type { Delta, UUID } from '../contracts/delta';
import type { FactsRow } from '../contracts/rows';
import { buildCopyPlan } from './copyModel';
import { cloneHead, emptyHead, fold, type Head } from './deltas';
import { headHash } from './head';
import { deserializeHeadProjection, serializeHeadProjection } from './projection';

/** Stands in for the person who asserted a fact in the sample's own organisation. */
export const SAMPLE_NIL_AUTHOR: UUID = '00000000-0000-0000-0000-000000000000';

/** The columns of a `sources` row a sample builder reads. */
export interface SampleSourceInput {
  id: UUID;
  kind: SampleSource['kind'];
  name: string;
  captured_at: string | null;
  capability_map_id: UUID | null;
}

/** The columns of an `aliases` row a sample builder reads. */
export interface SampleAliasInput {
  element_id: UUID;
  alias_value: string;
  alias_type: string;
  source_id: UUID;
  confidence: number;
}

const COPYABLE_ALIAS_TYPES: ReadonlySet<string> = new Set(['name', 'code', 'external_ref', 'source_system_key', 'template_code']);

/** Names the thing wrong when a head cannot be published as a sample. */
export function buildSamplePayload(head: Head, sources: readonly SampleSourceInput[], aliases: readonly SampleAliasInput[]): SamplePayload {
  if (head.elements.size === 0) throw new Error('buildSamplePayload: there is nothing in this model to publish');
  const projection = serializeHeadProjection(head);
  const facts: FactsRow[] = projection.facts.map((fact) => ({ ...fact, asserted_by: SAMPLE_NIL_AUTHOR }));

  const keptAliases: SampleAlias[] = aliases
    .filter((alias) => COPYABLE_ALIAS_TYPES.has(alias.alias_type) && head.elements.has(alias.element_id))
    .map((alias) => ({ element_id: alias.element_id, alias_value: alias.alias_value, alias_type: alias.alias_type as SampleAlias['alias_type'], source_id: alias.source_id, confidence: alias.confidence }));

  const usedSourceIds = new Set<UUID>([...facts.map((fact) => fact.source_id), ...keptAliases.map((alias) => alias.source_id)]);
  const byId = new Map(sources.map((source) => [source.id, source] as const));
  const keptSources: SampleSource[] = [];
  for (const id of [...usedSourceIds].sort()) {
    const source = byId.get(id);
    if (!source) throw new Error(`buildSamplePayload: a fact names source ${id}, which was not supplied`);
    keptSources.push({ id, kind: source.kind, name: source.name, uri: null, captured_at: source.captured_at, capability_map_id: source.kind === 'template' ? source.capability_map_id : null });
  }

  return { elementsHead: projection.elementsHead, relationshipsHead: projection.relationshipsHead, facts, sources: keptSources, aliases: keptAliases };
}

export function samplePayloadToHead(payload: SamplePayload): Head {
  return deserializeHeadProjection(payload.elementsHead, payload.relationshipsHead, payload.facts);
}

/** A `sources` row of the copy: a plain kind a signed-in owner or architect may insert themselves. */
export interface SampleCopySource {
  id: UUID;
  kind: 'document' | 'spreadsheet' | 'interview';
  name: string;
  captured_at: string | null;
}

/** An `aliases` row of the copy, against the new element and source ids. */
export interface SampleCopyAlias {
  element_id: UUID;
  alias_value: string;
  alias_type: 'name' | 'code' | 'external_ref' | 'source_system_key';
  source_id: UUID;
  confidence: number;
}

export interface SampleCopyPlan {
  deltas: Delta[];
  sources: SampleCopySource[];
  aliases: SampleCopyAlias[];
  headHash: string;
  elementCount: number;
  relationshipCount: number;
}

/**
 * A copy may only use what the ordinary row-level security lets a signed-in
 * owner or architect insert: a `document`, `spreadsheet` or `interview` source
 * keeps its kind; every other kind (a capability map, a capture job, a person,
 * a merge, an attestation) becomes a `document` source with the same name, so
 * no id from the sample's organisation is carried over.
 */
function copyKind(kind: SamplePayload['sources'][number]['kind']): SampleCopySource['kind'] {
  return kind === 'document' || kind === 'spreadsheet' || kind === 'interview' ? kind : 'document';
}

/** Aliases the ordinary insert policy allows; a capability map's `template_code` aliases are not copied. */
const INSERTABLE_ALIAS_TYPES: ReadonlySet<string> = new Set(['name', 'code', 'external_ref', 'source_system_key']);

/** The one commit, the sources and the aliases that copy `payload` into a new, empty model — fresh ids from `mintId`. */
export function planSampleCopy(payload: SamplePayload, authorId: UUID, createdAt: string, mintId: () => UUID): SampleCopyPlan {
  const head = samplePayloadToHead(payload);
  if (head.elements.size === 0) throw new Error('planSampleCopy: there is nothing in this sample to copy');
  const sourceIds = new Set<UUID>([...head.facts.values()].map((fact) => fact.sourceId));
  for (const alias of payload.aliases) sourceIds.add(alias.source_id);
  const sourceIdMap = new Map([...sourceIds].sort().map((old) => [old, mintId()] as const));
  const plan = buildCopyPlan(head, sourceIdMap, mintId);
  const copied = fold(cloneHead(emptyHead()), plan.deltas, { authorId, createdAt });

  const sourceById = new Map(payload.sources.map((source) => [source.id, source] as const));
  const sources: SampleCopySource[] = [];
  for (const [oldId, newId] of sourceIdMap) {
    const source = sourceById.get(oldId);
    if (!source) throw new Error(`planSampleCopy: the sample names source ${oldId}, which it does not hold`);
    sources.push({ id: newId, kind: copyKind(source.kind), name: source.name, captured_at: source.captured_at });
  }

  const aliases: SampleCopyAlias[] = [];
  for (const alias of payload.aliases) {
    const elementId = plan.elementIdMap.get(alias.element_id);
    const sourceId = sourceIdMap.get(alias.source_id);
    if (elementId === undefined || sourceId === undefined || !INSERTABLE_ALIAS_TYPES.has(alias.alias_type)) continue;
    aliases.push({ element_id: elementId, alias_value: alias.alias_value, alias_type: alias.alias_type as SampleCopyAlias['alias_type'], source_id: sourceId, confidence: alias.confidence });
  }

  return { deltas: plan.deltas, sources, aliases, headHash: headHash(copied), elementCount: copied.elements.size, relationshipCount: copied.relationships.size };
}
