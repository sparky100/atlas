import { describe, expect, it } from 'vitest';
import { emptyHead, factMapKey, type FactRow } from '../engine/deltas';
import { attributeFactsFromHead, factsRowsFromHead } from './branchFacts';

function fact(subjectId: string, attribute: string, overrides: Partial<FactRow> = {}): FactRow {
  return {
    subjectId,
    attribute,
    deltaId: `delta-${subjectId}-${attribute}`,
    sourceId: 'source-1',
    confidence: 1,
    authorId: 'author-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    value: 'a value',
    ...overrides,
  };
}

describe('factsRowsFromHead', () => {
  it('keys the result by attribute, for one subject only — a folded Head is the only source of truth for a change branch (no materialised facts table, SPEC §1 S-2)', () => {
    const head = emptyHead();
    head.facts.set(factMapKey('el-1', 'name'), fact('el-1', 'name', { value: 'Housing Options' }));
    head.facts.set(factMapKey('el-1', 'vendor'), fact('el-1', 'vendor', { value: 'Acme Corp' }));
    head.facts.set(factMapKey('el-2', 'name'), fact('el-2', 'name', { value: 'A different element' }));

    const result = factsRowsFromHead(head, 'element', 'el-1');

    expect([...result.keys()].sort()).toEqual(['name', 'vendor']);
    expect(result.get('name')).toMatchObject({ subject_type: 'element', subject_id: 'el-1', attribute: 'name', value: 'Housing Options', delta_id: 'delta-el-1-name' });
  });

  it('maps every FactRow field to its FactsRow name — the same shape src/ui/elements/useElementEditor.ts and friends already consume', () => {
    const head = emptyHead();
    head.facts.set(
      factMapKey('el-1', 'lifecycleStatus'),
      fact('el-1', 'lifecycleStatus', { value: 'active', sourceId: 'source-42', sourceRef: 'row 7', effectiveDate: '2025-06-01', confidence: 0.8, authorId: 'author-9', createdAt: '2026-02-03T04:05:06.000Z' }),
    );

    const result = factsRowsFromHead(head, 'element', 'el-1');

    expect(result.get('lifecycleStatus')).toEqual({
      subject_type: 'element',
      subject_id: 'el-1',
      attribute: 'lifecycleStatus',
      value: 'active',
      delta_id: 'delta-el-1-lifecycleStatus',
      source_id: 'source-42',
      source_ref: 'row 7',
      effective_date: '2025-06-01',
      confidence: 0.8,
      asserted_by: 'author-9',
      asserted_at: '2026-02-03T04:05:06.000Z',
    });
  });

  it('returns an empty map when the subject has no facts in this Head', () => {
    const head = emptyHead();
    head.facts.set(factMapKey('el-1', 'name'), fact('el-1', 'name'));

    expect(factsRowsFromHead(head, 'element', 'el-404').size).toBe(0);
  });
});

describe('attributeFactsFromHead (F12 bulk edit)', () => {
  it('groups only the requested attributes, only for elements (not relationship facts)', () => {
    const head = emptyHead();
    head.elements.set('el-1', {} as never);
    head.elements.set('el-2', {} as never);
    head.facts.set(factMapKey('el-1', 'criticality'), fact('el-1', 'criticality', { value: 'high' }));
    head.facts.set(factMapKey('el-1', 'name'), fact('el-1', 'name'));
    head.facts.set(factMapKey('el-2', 'disposition'), fact('el-2', 'disposition', { value: 'migrate' }));
    head.facts.set(factMapKey('rel-1', 'criticality'), fact('rel-1', 'criticality'));

    const result = attributeFactsFromHead(head, new Set(['criticality', 'disposition']));

    expect([...result.keys()].sort()).toEqual(['el-1', 'el-2']);
    expect([...(result.get('el-1')?.keys() ?? [])]).toEqual(['criticality']);
    expect(result.get('el-2')?.get('disposition')).toMatchObject({ subject_type: 'element', value: 'migrate', delta_id: 'delta-el-2-disposition' });
  });
});
