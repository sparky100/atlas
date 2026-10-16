import { describe, expect, it } from 'vitest';
import type { RelationshipVersionDiff } from '../../../engine/versionDiff';
import { DIFF_MARKER, diffBorderColour, edgeDiffState, polylineMidpoint } from './diffCanvas';

const tokens = { diffAdded: 'green', diffRemoved: 'red', diffChanged: 'amber' };
const rel = (relationshipId: string, state: RelationshipVersionDiff['state']): RelationshipVersionDiff => ({ relationshipId, state, asIs: null, toBe: null, changedAttributes: [] });

describe('diff canvas conventions', () => {
  it('gives each state its own colour and marker, and unchanged neither', () => {
    expect(diffBorderColour('added', tokens)).toBe('green');
    expect(diffBorderColour('removed', tokens)).toBe('red');
    expect(diffBorderColour('changed', tokens)).toBe('amber');
    expect(diffBorderColour('moved', tokens)).toBe('amber');
    expect(diffBorderColour('unchanged', tokens)).toBeNull();
    expect([DIFF_MARKER.added, DIFF_MARKER.removed, DIFF_MARKER.changed, DIFF_MARKER.unchanged]).toEqual(['+', '−', '~', '']);
  });

  it('takes the most newsworthy state of the relationships one drawn edge stands for', () => {
    const byId = new Map([rel('a', 'unchanged'), rel('b', 'changed'), rel('c', 'removed'), rel('d', 'added')].map((r) => [r.relationshipId, r]));
    expect(edgeDiffState(['a'], byId)).toBe('unchanged');
    expect(edgeDiffState(['a', 'b'], byId)).toBe('changed');
    expect(edgeDiffState(['b', 'c'], byId)).toBe('removed');
    expect(edgeDiffState(['c', 'd'], byId)).toBe('added');
    expect(edgeDiffState(['not-in-the-diff'], byId)).toBe('unchanged');
  });

  it('finds the midpoint along a bent edge by length, not by its endpoints', () => {
    expect(polylineMidpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual({ x: 5, y: 0 });
    expect(polylineMidpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toEqual({ x: 10, y: 0 });
  });
});
