import { describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { parseSamplePayload } from '../contracts/sampleModel';
import { cloneHead, emptyHead, fold } from './deltas';
import { buildSamplePayload, planSampleCopy, SAMPLE_NIL_AUTHOR, samplePayloadToHead } from './sampleModel';

const AUTHOR = 'person-in-source-org';
const ctx = { authorId: AUTHOR, createdAt: '2026-01-01T00:00:00.000Z' };
function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}-${String((n += 1)).padStart(4, '0')}`;
}

const SRC_MANUAL = 'src-manual';
const SRC_MAP = 'src-map';
const SRC_UNUSED = 'src-unused';

function sourceHead() {
  const deltas = [
    { kind: 'element.create', id: 'd1', elementId: 'cap', elementType: 'capability', name: 'Billing', parentId: null, attributes: {}, sourceId: SRC_MAP, confidence: 1 },
    { kind: 'element.create', id: 'd2', elementId: 'sys', elementType: 'system', name: 'Invoicer', parentId: null, attributes: { isExternal: false, lifecycleStatus: 'active', description: 'Bills customers' }, sourceId: SRC_MANUAL, confidence: 0.7 },
    { kind: 'relationship.create', id: 'd3', relationshipId: 'rel', relationshipType: 'supports', fromElementId: 'sys', toElementId: 'cap', attributes: { role: 'primary' }, sourceId: SRC_MANUAL, confidence: 1 },
  ] as unknown as Delta[];
  return fold(cloneHead(emptyHead()), deltas, ctx);
}

const sources = [
  { id: SRC_MANUAL, kind: 'manual' as const, name: 'Manual entry', captured_at: null, capability_map_id: null },
  { id: SRC_MAP, kind: 'template' as const, name: 'Electricity network v4', captured_at: null, capability_map_id: 'map-1' },
  { id: SRC_UNUSED, kind: 'capture_job' as const, name: 'Old import', captured_at: null, capability_map_id: null },
];
const aliases = [
  { element_id: 'sys', alias_value: 'INV', alias_type: 'code', source_id: SRC_MANUAL, confidence: 1 },
  { element_id: 'sys', alias_value: 'old-id', alias_type: 'merged_id', source_id: SRC_MANUAL, confidence: 1 },
  { element_id: 'gone', alias_value: 'Ghost', alias_type: 'name', source_id: SRC_MANUAL, confidence: 1 },
];

describe('buildSamplePayload', () => {
  const payload = buildSamplePayload(sourceHead(), sources, aliases);

  it('removes every person id and every link out', () => {
    expect(payload.facts.length).toBeGreaterThan(0);
    for (const fact of payload.facts) expect(fact.asserted_by).toBe(SAMPLE_NIL_AUTHOR);
    expect(JSON.stringify(payload)).not.toContain(AUTHOR);
    for (const source of payload.sources) expect(source.uri).toBeNull();
  });

  it('keeps only the sources a fact or alias names, and a capability map link only on a template', () => {
    expect(payload.sources.map((s) => s.id).sort()).toEqual([SRC_MANUAL, SRC_MAP]);
    expect(payload.sources.find((s) => s.id === SRC_MAP)?.capability_map_id).toBe('map-1');
    expect(payload.sources.find((s) => s.id === SRC_MANUAL)?.capability_map_id).toBeNull();
  });

  it('keeps copyable aliases of live elements only', () => {
    expect(payload.aliases.map((a) => a.alias_value)).toEqual(['INV']);
  });

  it('is valid for the contract, and survives JSON', () => {
    expect(parseSamplePayload(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  });

  it('refuses an empty model and a missing source', () => {
    expect(() => buildSamplePayload(emptyHead(), sources, [])).toThrow(/nothing in this model/);
    expect(() => buildSamplePayload(sourceHead(), [], [])).toThrow(/was not supplied/);
  });
});

describe('planSampleCopy', () => {
  const payload = buildSamplePayload(sourceHead(), sources, aliases);
  const plan = planSampleCopy(payload, 'new-owner', '2026-06-01T00:00:00.000Z', counter('id'));
  const copied = fold(cloneHead(emptyHead()), plan.deltas, { authorId: 'new-owner', createdAt: '2026-06-01T00:00:00.000Z' });

  it('copies every element and relationship under fresh ids with the same content', () => {
    expect(plan.elementCount).toBe(2);
    expect(plan.relationshipCount).toBe(1);
    expect(copied.elements.size).toBe(2);
    expect([...copied.elements.keys()].every((id) => id.startsWith('id-'))).toBe(true);
    expect([...copied.elements.values()].map((e) => e.name).sort()).toEqual(['Billing', 'Invoicer']);
    const system = [...copied.elements.values()].find((e) => e.name === 'Invoicer');
    expect(system?.attributes).toMatchObject({ description: 'Bills customers', lifecycleStatus: 'active' });
  });

  it('keeps each fact’s original confidence', () => {
    const confidences = [...copied.facts.values()].filter((f) => f.attribute === '$exists').map((f) => f.confidence).sort();
    expect(confidences).toEqual([0.7, 1, 1]); // the system, the capability, the supports relationship
  });

  it('gives every source a fresh id and a kind an ordinary owner or architect may insert', () => {
    expect(plan.sources).toHaveLength(2);
    for (const source of plan.sources) {
      expect(source.id.startsWith('id-')).toBe(true);
      expect(['document', 'spreadsheet', 'interview']).toContain(source.kind);
    }
    // A capability map and a person's manual entry both become plain document sources, keeping their names.
    expect(plan.sources.map((s) => s.name).sort()).toEqual(['Electricity network v4', 'Manual entry']);
    const sourceIds = new Set(plan.sources.map((s) => s.id));
    for (const delta of plan.deltas) expect(sourceIds.has(delta.sourceId)).toBe(true);
  });

  it('copies aliases against the new element and source ids, and drops codes that need a system path', () => {
    expect(plan.aliases).toHaveLength(1);
    const alias = plan.aliases[0];
    expect(alias).toMatchObject({ alias_value: 'INV', alias_type: 'code' });
    expect(copied.elements.has(alias?.element_id ?? '')).toBe(true);
    expect(plan.sources.map((s) => s.id)).toContain(alias?.source_id);

    const withTemplateCode = { ...payload, aliases: [...payload.aliases, { element_id: 'cap', alias_value: 'BC-1', alias_type: 'template_code' as const, source_id: SRC_MAP, confidence: 1 }] };
    expect(planSampleCopy(withTemplateCode, 'x', '2026-06-01T00:00:00.000Z', counter('id')).aliases).toHaveLength(1);
  });

  it('is reproducible: the same payload and the same minter give the same head hash', () => {
    const again = planSampleCopy(payload, 'new-owner', '2026-06-01T00:00:00.000Z', counter('id'));
    expect(again.headHash).toBe(plan.headHash);
    const different = planSampleCopy(payload, 'new-owner', '2026-06-01T00:00:00.000Z', counter('other'));
    expect(different.headHash).not.toBe(plan.headHash);
  });

  it('round-trips: the payload’s own head is what was published', () => {
    const head = samplePayloadToHead(payload);
    expect(head.elements.size).toBe(2);
    expect(head.relationships.size).toBe(1);
  });

  it('refuses an empty sample', () => {
    expect(() => planSampleCopy({ ...payload, elementsHead: [], relationshipsHead: [], facts: [] }, 'x', '2026-06-01T00:00:00.000Z', counter('id'))).toThrow(/nothing in this sample/);
  });
});
