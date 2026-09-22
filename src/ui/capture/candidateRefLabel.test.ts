import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import { candidateRefLabel } from './candidateRefLabel';

const mainElementById = new Map<string, ElementsHeadRow>([
  ['el-1', { element_id: 'el-1', element_type: 'system', name: 'Housing Platform', parent_id: null, attributes: {}, exists_delta_id: 'd-1' }],
]);

const draftElementById = new Map<string, string>([['draft-1', 'Outage Planning']]);

describe('candidateRefLabel', () => {
  it('null ref has no label', () => {
    expect(candidateRefLabel(null, mainElementById, draftElementById)).toBeNull();
  });

  it('unresolved ref shows its own raw text', () => {
    expect(candidateRefLabel({ kind: 'unresolved', text: 'Some Platform' }, mainElementById, draftElementById)).toBe('Some Platform');
  });

  it('candidate ref (this document) shows a fixed label', () => {
    expect(candidateRefLabel({ kind: 'candidate', seq: 3 }, mainElementById, draftElementById)).toBe('(this document)');
  });

  it('existing ref resolves to the main element\'s own name', () => {
    expect(candidateRefLabel({ kind: 'existing', elementId: 'el-1' }, mainElementById, draftElementById)).toBe('Housing Platform');
  });

  it('existing ref that is a draft subject resolves to the draft element\'s name, not a raw id', () => {
    expect(candidateRefLabel({ kind: 'existing', elementId: 'draft-1' }, mainElementById, draftElementById)).toBe('Outage Planning');
  });

  it('existing ref not found on main or in the draft falls back to the raw id', () => {
    expect(candidateRefLabel({ kind: 'existing', elementId: 'el-missing' }, mainElementById, draftElementById)).toBe('el-missing');
  });
});
