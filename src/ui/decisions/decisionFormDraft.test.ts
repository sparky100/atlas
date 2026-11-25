import { describe, expect, it } from 'vitest';
import { clearDecisionFormDraft, decisionFormDraftKey, draftDiffers, loadDecisionFormDraft, saveDecisionFormDraft } from './decisionFormDraft';
import { PENDING_TTL_MS, type StorageLike } from './pendingOptions';

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}
const KEY = decisionFormDraftKey('o', 'u', 'decisions-m');

describe('decision form draft', () => {
  it('keeps what was typed and gives it back', () => {
    const s = memory();
    saveDecisionFormDraft(s, KEY, { title: 'Quotes', statement: 'Same-day quotes' }, 1000);
    expect(loadDecisionFormDraft(s, KEY, 2000)).toEqual({ title: 'Quotes', statement: 'Same-day quotes', outcome: '' });
  });
  it('is per organisation, person and place', () => {
    expect(decisionFormDraftKey('o', 'u', 'a')).not.toBe(decisionFormDraftKey('o', 'v', 'a'));
    expect(decisionFormDraftKey('o', 'u', 'a')).not.toBe(decisionFormDraftKey('p', 'u', 'a'));
    expect(decisionFormDraftKey('o', 'u', 'a')).not.toBe(decisionFormDraftKey('o', 'u', 'b'));
  });
  it('forgets a draft after 24 hours and removes it', () => {
    const s = memory();
    saveDecisionFormDraft(s, KEY, { title: 'x', statement: '' }, 0);
    expect(loadDecisionFormDraft(s, KEY, PENDING_TTL_MS + 1)).toBeNull();
    expect(s.data.size).toBe(0);
  });
  it('holds nothing when both fields are empty, and ignores unreadable data', () => {
    const s = memory();
    saveDecisionFormDraft(s, KEY, { title: '  ', statement: '' }, 0);
    expect(s.data.size).toBe(0);
    s.setItem(KEY, '{nope');
    expect(loadDecisionFormDraft(s, KEY, 1)).toBeNull();
    expect(s.data.size).toBe(0);
  });
  it('can be cleared once the decision is started', () => {
    const s = memory();
    saveDecisionFormDraft(s, KEY, { title: 'x', statement: 'y' }, 0);
    clearDecisionFormDraft(s, KEY);
    expect(loadDecisionFormDraft(s, KEY, 1)).toBeNull();
  });
  it('is offered back only when it differs from the form', () => {
    expect(draftDiffers(null, { title: '', statement: '' })).toBe(false);
    expect(draftDiffers({ title: 'a', statement: 'b' }, { title: 'a', statement: 'b' })).toBe(false);
    expect(draftDiffers({ title: 'a', statement: 'b' }, { title: 'a', statement: '' })).toBe(true);
  });
});
