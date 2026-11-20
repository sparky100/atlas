import { describe, expect, it } from 'vitest';
import { emptyHead, type ElementRow, type Head, type RelationshipRow } from '../../engine/deltas';
import { cleanChangeCount, cleanChangeList } from './cleanChangeList';

const sys = (name: string): ElementRow => ({ elementType: 'system', name, parentId: null, attributes: {}, existsDeltaId: 'd1' });
const supports = (from: string, to: string): RelationshipRow => ({ relationshipType: 'supports', fromElementId: from, toElementId: to, attributes: {}, existsDeltaId: 'd2' });

function model(extra: (h: Head) => void): Head {
  const h = emptyHead();
  for (let i = 0; i < 84; i++) h.elements.set(`e${String(i)}`, sys(`System ${String(i)}`));
  extra(h);
  return h;
}

describe('the Clean changes list and its count', () => {
  const base = model(() => undefined);
  // The change adds one system and one link; the other 84 elements are untouched.
  const ours = model((h) => {
    h.elements.set('quote', sys('Quote Tool'));
    h.relationships.set('link', supports('quote', 'e0'));
  });
  // `classifyMerge` calls every subject in the model clean, touched or not.
  const everySubject = [...ours.elements.keys(), ...ours.relationships.keys()];

  it('lists only what the change added, edited or retired', () => {
    const list = cleanChangeList(base, ours, everySubject);
    expect(list.elements.map((e) => e.elementId)).toEqual(['quote']);
    expect(list.relationships.map((r) => r.relationshipId)).toEqual(['link']);
  });

  it('counts what it lists, not the whole model', () => {
    expect(everySubject).toHaveLength(86);
    expect(cleanChangeCount(base, ours, everySubject)).toBe(2);
  });

  it('leaves out a changed subject that has a conflict or warning, which has its own card', () => {
    expect(cleanChangeCount(base, ours, everySubject.filter((id) => id !== 'quote'))).toBe(1);
  });

  it('is zero when the change touched nothing', () => {
    expect(cleanChangeCount(base, base, everySubject)).toBe(0);
  });
});
