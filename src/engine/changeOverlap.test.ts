import { describe, expect, it } from 'vitest';
import { sharedElements, touchedElementsByBranch, type DeltaTouchRow } from './changeOverlap';

const ends = new Map([
  ['rel-int', { fromElementId: 'escoms', toElementId: 'enterprise' }],
  ['rel-other', { fromElementId: 'pm', toElementId: 'enterprise' }],
]);

describe('touchedElementsByBranch', () => {
  it('counts an element edit, and both ends of a relationship edit — including an update or retract that carries only the relationship id', () => {
    const rows: DeltaTouchRow[] = [
      { branchId: 'b1', subjectType: 'relationship', subjectId: 'rel-int' },
      { branchId: 'b2', subjectType: 'element', subjectId: 'tableau' },
      { branchId: 'b2', subjectType: 'relationship', subjectId: 'rel-other' },
    ];
    const touched = touchedElementsByBranch(rows, ends);
    expect([...(touched.get('b1') ?? [])].sort()).toEqual(['enterprise', 'escoms']);
    expect([...(touched.get('b2') ?? [])].sort()).toEqual(['enterprise', 'pm', 'tableau']);
  });

  it('skips a relationship whose ends are unknown rather than guessing', () => {
    const touched = touchedElementsByBranch([{ branchId: 'b1', subjectType: 'relationship', subjectId: 'rel-unknown' }], ends);
    expect(touched.get('b1')?.size).toBe(0);
  });
});

describe('sharedElements', () => {
  const parentOf = (id: string) => ({ escoms: 'salesforce', pm: 'sap', fi: 'sap', enterprise: 'arcgis' })[id] ?? null;

  it('two changes integrating with the same system share it', () => {
    expect(sharedElements(new Set(['escoms', 'enterprise']), new Set(['pm', 'enterprise']), parentOf)).toEqual(['enterprise']);
  });

  it('a platform edited on one change and its module on the other share the platform, either way round', () => {
    expect(sharedElements(new Set(['escoms']), new Set(['salesforce']), parentOf)).toEqual(['salesforce']);
    expect(sharedElements(new Set(['salesforce']), new Set(['escoms']), parentOf)).toEqual(['salesforce']);
  });

  it('sibling modules of one platform do not overlap', () => {
    expect(sharedElements(new Set(['pm']), new Set(['fi']), parentOf)).toEqual([]);
  });
});
