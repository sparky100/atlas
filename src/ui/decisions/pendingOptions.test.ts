import { describe, expect, it } from 'vitest';
import { loadPending, optionDescription, PENDING_TTL_MS, pendingKey, removePending, savePending, type PendingOption, type StorageLike } from './pendingOptions';

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}
const option = (id: string): PendingOption => ({ id, title: `Option ${id}`, summary: 's', toWeigh: '', suggestedTitle: `Option ${id}`, suggestedSummary: 's', draftedAt: '2026-11-19T10:00:00Z', catalogueRefs: [] });
const key = pendingKey('o', 'u', 'd');

describe('pending options', () => {
  it('keys by organisation, person and decision so nobody sees another person\'s draft', () => {
    expect(pendingKey('o1', 'u1', 'd')).not.toBe(pendingKey('o1', 'u2', 'd'));
    expect(pendingKey('o1', 'u1', 'd')).not.toBe(pendingKey('o2', 'u1', 'd'));
  });
  it('round-trips and removes one at a time, clearing the entry when none are left', () => {
    const s = memory();
    savePending(s, key, [option('a'), option('b')], 1000);
    expect(loadPending(s, key, 2000).map((o) => o.id)).toEqual(['a', 'b']);
    removePending(s, key, 'a', 2000);
    expect(loadPending(s, key, 2000).map((o) => o.id)).toEqual(['b']);
    removePending(s, key, 'b', 2000);
    expect(s.data.has(key)).toBe(false);
  });
  it('drops drafts older than 24 hours and unreadable ones', () => {
    const s = memory();
    savePending(s, key, [option('a')], 0);
    expect(loadPending(s, key, PENDING_TTL_MS + 1)).toEqual([]);
    expect(s.data.has(key)).toBe(false);
    s.setItem(key, '{ not json');
    expect(loadPending(s, key, 0)).toEqual([]);
    expect(s.data.has(key)).toBe(false);
  });
  it('writes the summary and what to weigh as the option description', () => {
    expect(optionDescription({ summary: ' Use it. ', toWeigh: '' })).toBe('Use it.');
    expect(optionDescription({ summary: 'Use it.', toWeigh: 'Fit' })).toBe('Use it.\n\nTo weigh: Fit');
  });
  it('loads a draft saved before catalogue refs existed as having none', () => {
    const s = memory();
    s.setItem(key, JSON.stringify({ savedAt: 1000, options: [{ id: 'a', title: 'Keep', summary: 's', toWeigh: '', suggestedTitle: 'Keep', suggestedSummary: 's', draftedAt: '2026-11-19T10:00:00Z' }] }));
    expect(loadPending(s, key, 2000)[0]?.catalogueRefs).toEqual([]);
  });
  it('keeps only well-formed catalogue refs from storage', () => {
    const s = memory();
    const valid = { sector: 'electricity_network', version: 1, entryCode: 'crm-x' };
    s.setItem(key, JSON.stringify({ savedAt: 1000, options: [{ ...option('a'), catalogueRefs: [valid, { sector: '', version: 0, entryCode: '' }] }] }));
    expect(loadPending(s, key, 2000)[0]?.catalogueRefs).toEqual([valid]);
  });
  it('never brings a held element id back after restore', () => {
    const s = memory();
    const id = '11111111-1111-4111-8111-111111111111';
    s.setItem(key, JSON.stringify({ savedAt: 1000, options: [{
      ...option('a'),
      title: `Keep [[element:${id}]]`,
      summary: `Use [[element:${id}]].`,
      toWeigh: `Check [[element:${id}]].`,
      suggestedTitle: `Keep [[element:${id}]]`,
      suggestedSummary: `Use [[element:${id}]].`,
    }] }));
    const loaded = loadPending(s, key, 2000)[0];
    expect(loaded?.title).toBe('Keep an element in the model');
    expect(loaded?.summary).toBe('Use an element in the model.');
    expect(loaded?.toWeigh).toBe('Check an element in the model.');
    expect(loaded?.suggestedTitle).toBe('Keep an element in the model');
    expect(loaded?.suggestedSummary).toBe('Use an element in the model.');
  });
  it('sanitises markers before writing and before making a description', () => {
    const s = memory();
    const id = '11111111-1111-4111-8111-111111111111';
    savePending(s, key, [{ ...option('a'), title: `Keep [[element:${id}]]`, summary: `Use [[element:${id}]].` }], 1000);
    expect(s.data.get(key)).not.toContain(id);
    expect(optionDescription({ summary: `Use [[element:${id}]].`, toWeigh: `Check [[element:${id}]].` }))
      .toBe('Use an element in the model.\n\nTo weigh: Check an element in the model.');
  });
});
