import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import { candidateRefLabel } from './candidateRefLabel';

const mainElementById = new Map<string, ElementsHeadRow>([
  ['el-1', { element_id: 'el-1', element_type: 'system', name: 'Housing Platform', parent_id: null, attributes: {}, exists_delta_id: 'd-1' }],
]);

describe('candidateRefLabel', () => {
  it('null ref has no label', () => {
    expect(candidateRefLabel(null, mainElementById)).toBeNull();
  });

  it('unresolved ref shows its own raw text', () => {
    expect(candidateRefLabel({ kind: 'unresolved', text: 'Some Platform' }, mainElementById)).toBe('Some Platform');
  });

  it('candidate ref (this document) shows a fixed label', () => {
    expect(candidateRefLabel({ kind: 'candidate', seq: 3 }, mainElementById)).toBe('(this document)');
  });

  it('existing ref resolves to the main element\'s own name', () => {
    expect(candidateRefLabel({ kind: 'existing', elementId: 'el-1' }, mainElementById)).toBe('Housing Platform');
  });

  it('existing ref not found on main falls back to the raw id', () => {
    expect(candidateRefLabel({ kind: 'existing', elementId: 'el-missing' }, mainElementById)).toBe('el-missing');
  });
});
