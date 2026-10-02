import { describe, expect, it } from 'vitest';
import type { AttributeFieldSchema } from '../contracts/attributeSchema';
import type { ElementsHeadRow, FactsRow, Json } from '../contracts/rows';
import { buildBulkEditDeltas, buildRelationshipAttributeDelta, bulkEditCellKey, draftEqualsFactValue, initialBulkEditDraft } from './bulkEdit';

function element(id: string, type: ElementsHeadRow['element_type'] = 'system'): ElementsHeadRow {
  return { element_id: id, element_type: type, name: `Element ${id}`, parent_id: null, attributes: {}, exists_delta_id: `exists-${id}` };
}

function fact(subjectId: string, attribute: string, value: Json): FactsRow {
  return { subject_type: 'element', subject_id: subjectId, attribute, value, delta_id: `fact-${subjectId}-${attribute}`, source_id: 's', source_ref: null, effective_date: null, confidence: 1, asserted_by: 'u', asserted_at: '2026-01-01T00:00:00Z' };
}

function ids(): () => string {
  let n = 0;
  return () => `id-${String(++n)}`;
}

const elementsById = new Map([
  ['a', element('a')],
  ['b', element('b')],
  ['cap', element('cap', 'capability')],
]);

describe('buildBulkEditDeltas', () => {
  it('makes one delta per changed cell, superseding the current fact or the existence delta, all under one source at confidence 1', () => {
    const factsByElement = new Map([['a', new Map([['criticality', fact('a', 'criticality', 'low')]])]]);
    const result = buildBulkEditDeltas({
      cells: [
        { elementId: 'a', key: 'criticality', draft: 'high' },
        { elementId: 'b', key: 'disposition', draft: 'migrate' },
      ],
      elementsById,
      factsByElement,
      customFields: new Map(),
      sourceId: 'src-1',
      newId: ids(),
    });
    expect(result).toEqual({
      ok: true,
      deltas: [
        { kind: 'element.update', id: 'id-1', elementId: 'a', elementType: 'system', attribute: 'criticality', value: 'high', previousDeltaId: 'fact-a-criticality', sourceId: 'src-1', confidence: 1 },
        { kind: 'element.update', id: 'id-2', elementId: 'b', elementType: 'system', attribute: 'disposition', value: 'migrate', previousDeltaId: 'exists-b', sourceId: 'src-1', confidence: 1 },
      ],
    });
  });

  it('skips a cell that equals the current value, and clears an optional value with an empty draft', () => {
    const factsByElement = new Map([['a', new Map([['criticality', fact('a', 'criticality', 'low')], ['disposition', fact('a', 'disposition', 'invest')]])]]);
    const result = buildBulkEditDeltas({
      cells: [
        { elementId: 'a', key: 'criticality', draft: 'low' },
        { elementId: 'a', key: 'disposition', draft: '' },
      ],
      elementsById,
      factsByElement,
      customFields: new Map(),
      sourceId: 'src-1',
      newId: ids(),
    });
    expect(result.ok && result.deltas.map((d) => ('attribute' in d ? [d.attribute, d.value] : null))).toEqual([['disposition', null]]);
  });

  it('refuses the whole save, per cell, when any value is invalid or the attribute does not apply to the type', () => {
    const result = buildBulkEditDeltas({
      cells: [
        { elementId: 'a', key: 'criticality', draft: 'enormous' },
        { elementId: 'cap', key: 'criticality', draft: 'high' },
        { elementId: 'b', key: 'disposition', draft: 'invest' },
      ],
      elementsById,
      factsByElement: new Map(),
      customFields: new Map(),
      sourceId: 'src-1',
      newId: ids(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect([...result.errors.keys()].sort()).toEqual([bulkEditCellKey('a', 'criticality'), bulkEditCellKey('cap', 'criticality')].sort());
  });

  it('writes a custom attribute as element.update_custom, only for the types its definition applies to', () => {
    const field: AttributeFieldSchema = { key: 'vendor', label: 'Vendor', required: false, kind: 'text' };
    const customFields = new Map([['vendor', { field, appliesTo: ['system'] }]]);
    const ok = buildBulkEditDeltas({ cells: [{ elementId: 'a', key: 'vendor', draft: ' Acme ' }], elementsById, factsByElement: new Map(), customFields, sourceId: 's', newId: ids() });
    expect(ok.ok && ok.deltas[0]).toMatchObject({ kind: 'element.update_custom', attribute: 'vendor', value: 'Acme' });
    const refused = buildBulkEditDeltas({ cells: [{ elementId: 'cap', key: 'vendor', draft: 'Acme' }], elementsById, factsByElement: new Map(), customFields, sourceId: 's', newId: ids() });
    expect(refused.ok).toBe(false);
  });
});

describe('draft helpers', () => {
  it('treats an empty draft as equal to an unset value, and a number fact as equal to its string draft', () => {
    expect(draftEqualsFactValue('', undefined)).toBe(true);
    expect(draftEqualsFactValue('', null)).toBe(true);
    expect(draftEqualsFactValue('3', 3)).toBe(true);
    expect(draftEqualsFactValue('high', 'low')).toBe(false);
    expect(initialBulkEditDraft(null)).toBe('');
    expect(initialBulkEditDraft(7)).toBe('7');
    expect(initialBulkEditDraft(true)).toBe(true);
  });
});

describe('buildRelationshipAttributeDelta', () => {
  const edge = { relationship_id: 'r1', relationship_type: 'supports' as const, from_element_id: 'a', to_element_id: 'cap', attributes: {}, exists_delta_id: 'exists-r1' };

  it('rates an unrated edge, superseding its existence delta', () => {
    expect(buildRelationshipAttributeDelta({ relationship: edge, key: 'fitForPurpose', draft: 'good', current: undefined, sourceId: 's', newId: ids() })).toEqual({
      ok: true,
      delta: { kind: 'relationship.update', id: 'id-1', relationshipId: 'r1', relationshipType: 'supports', attribute: 'fitForPurpose', value: 'good', previousDeltaId: 'exists-r1', sourceId: 's', confidence: 1 },
    });
  });

  it('writes nothing for an unchanged value, and refuses an invalid one', () => {
    const current = { ...fact('r1', 'fitForPurpose', 'good'), subject_type: 'relationship' as const };
    expect(buildRelationshipAttributeDelta({ relationship: edge, key: 'fitForPurpose', draft: 'good', current, sourceId: 's', newId: ids() })).toEqual({ ok: true, delta: null });
    expect(buildRelationshipAttributeDelta({ relationship: edge, key: 'fitForPurpose', draft: 'splendid', current, sourceId: 's', newId: ids() }).ok).toBe(false);
  });
});
