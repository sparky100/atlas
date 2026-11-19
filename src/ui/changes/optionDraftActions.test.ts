import { describe, expect, it } from 'vitest';
import { optionDraftActions, optionDraftLabel } from './optionDraftActions';

const sys = (n: number, name: string) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, name });

describe('optionDraftActions', () => {
  it('offers retire-and-replace for a named system and extend for supporters, not the named one twice', () => {
    const actions = optionDraftActions([sys(1, 'DUoS Billing Engine')], [sys(1, 'DUoS Billing Engine'), sys(2, 'Utilities Billing (IS-U)')], ['Billing & Settlement']);
    expect(actions.map(optionDraftLabel)).toEqual(['Retire DUoS Billing Engine and replace it with a new system', 'Extend Utilities Billing (IS-U) to cover Billing & Settlement']);
  });

  it('offers nothing to extend when the decision names no capability', () => {
    expect(optionDraftActions([], [sys(2, 'IS-U')], [])).toEqual([]);
  });

  it('caps each kind at three', () => {
    const many = [1, 2, 3, 4, 5].map((n) => sys(n, `S${String(n)}`));
    expect(optionDraftActions(many, [], ['C'])).toHaveLength(3);
  });
});
