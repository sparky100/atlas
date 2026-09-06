/**
 * Concrete, worked examples — one per DeltaKind — kept separate from the
 * property tests in delta.property.test.ts. These exist for a human
 * skimming the contract to see one real shape per kind, and to pin down
 * subjectOf/factKeyOf's behaviour in cases worth naming explicitly.
 */
import { describe, expect, it } from 'vitest';
import { EXISTS_ATTRIBUTE, type Delta, factKeyOf, subjectOf } from './delta';
import { fromDeltaRow, toDeltaRow } from './rows';

const ctx = { orgId: 'org-1', modelId: 'model-1', commitId: 'commit-1', seq: 0, createdBy: 'user-1' };

describe('one worked example per DeltaKind', () => {
  it('element.create', () => {
    const d: Delta = {
      kind: 'element.create',
      id: 'delta-1',
      elementId: 'el-1',
      elementType: 'capability',
      name: 'Revenues and Benefits',
      parentId: null,
      attributes: { level: 1 },
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(subjectOf(d)).toEqual({ subjectType: 'element', subjectId: 'el-1' });
    expect(factKeyOf(d)).toEqual({ subjectId: 'el-1', attribute: EXISTS_ATTRIBUTE });
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('element.update', () => {
    const d: Delta = {
      kind: 'element.update',
      id: 'delta-2',
      elementId: 'el-1',
      elementType: 'system',
      attribute: 'lifecycleStatus',
      value: 'retiring',
      previousDeltaId: 'delta-1',
      sourceId: 'src-1',
      confidence: 0.8,
    };
    expect(factKeyOf(d)).toEqual({ subjectId: 'el-1', attribute: 'lifecycleStatus' });
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('element.update clearing an optional attribute (value: null)', () => {
    const d: Delta = {
      kind: 'element.update',
      id: 'delta-3',
      elementId: 'el-1',
      elementType: 'system',
      attribute: 'vendor',
      value: null,
      previousDeltaId: 'delta-1',
      sourceId: 'src-1',
      confidence: 1,
    };
    const row = toDeltaRow(d, ctx);
    expect(row.value).toBeNull();
    expect(fromDeltaRow(row)).toEqual(d);
  });

  it('element.retract', () => {
    const d: Delta = {
      kind: 'element.retract',
      id: 'delta-4',
      elementId: 'el-1',
      elementType: 'system',
      previousDeltaId: 'delta-1',
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(factKeyOf(d)).toEqual({ subjectId: 'el-1', attribute: EXISTS_ATTRIBUTE });
    const row = toDeltaRow(d, ctx);
    expect(row.value).toBeNull();
    expect(row.name).toBeNull();
    expect(fromDeltaRow(row)).toEqual(d);
  });

  it('element.restore', () => {
    const d: Delta = {
      kind: 'element.restore',
      id: 'delta-5',
      elementId: 'el-1',
      elementType: 'system',
      previousDeltaId: 'delta-4',
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('relationship.create', () => {
    const d: Delta = {
      kind: 'relationship.create',
      id: 'delta-6',
      relationshipId: 'rel-1',
      relationshipType: 'flows_to',
      fromElementId: 'el-1',
      toElementId: 'el-2',
      attributes: { dataClassification: 'official' },
      sourceId: 'src-1',
      confidence: 0.7,
    };
    expect(subjectOf(d)).toEqual({ subjectType: 'relationship', subjectId: 'rel-1' });
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('relationship.update', () => {
    const d: Delta = {
      kind: 'relationship.update',
      id: 'delta-7',
      relationshipId: 'rel-1',
      relationshipType: 'owns',
      attribute: 'primary',
      value: true,
      previousDeltaId: 'delta-6',
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('relationship.retract', () => {
    const d: Delta = {
      kind: 'relationship.retract',
      id: 'delta-8',
      relationshipId: 'rel-1',
      relationshipType: 'uses',
      previousDeltaId: 'delta-6',
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('relationship.restore', () => {
    const d: Delta = {
      kind: 'relationship.restore',
      id: 'delta-9',
      relationshipId: 'rel-1',
      relationshipType: 'uses',
      previousDeltaId: 'delta-8',
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });
});

describe('EXISTS_ATTRIBUTE is the fact key for every non-update kind', () => {
  it('is the literal string "$exists"', () => {
    expect(EXISTS_ATTRIBUTE).toBe('$exists');
  });
});
