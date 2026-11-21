import { describe, expect, it } from 'vitest';
import { planCapabilityMapItemIds } from './capabilityMapItemIds';

const existing = [
  { id: 'id-a', code: '1' },
  { id: 'id-b', code: '2' },
  { id: 'id-c', code: '3' },
];

describe('planCapabilityMapItemIds', () => {
  it('keeps the id of every code still in the file, and removes only codes that went', () => {
    const plan = planCapabilityMapItemIds(existing, ['1', '3', '4'], () => 'new-id');
    expect([...plan.idByCode]).toEqual([['1', 'id-a'], ['3', 'id-c'], ['4', 'new-id']]);
    expect(plan.removedIds).toEqual(['id-b']);
  });

  it('gives every code a fresh id on a first load', () => {
    const plan = planCapabilityMapItemIds([], ['1', '2'], () => 'new-id');
    expect([...plan.idByCode.values()]).toEqual(['new-id', 'new-id']);
    expect(plan.removedIds).toEqual([]);
  });

  it('does not remove anything when the file is unchanged', () => {
    const plan = planCapabilityMapItemIds(existing, ['1', '2', '3']);
    expect(plan.removedIds).toEqual([]);
    expect([...plan.idByCode.values()]).toEqual(['id-a', 'id-b', 'id-c']);
  });
});
