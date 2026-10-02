import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { BranchRow, DecisionLinkRow, DecisionRow } from '../../db/types';
import { buildDecisionAdrExportInput } from './decisionAdrInput';

const decision = { id: 'd', branch_id: 'b1', status: 'accepted' } as DecisionRow;
const link = (linked_type: DecisionLinkRow['linked_type'], linked_id: string): DecisionLinkRow => ({ decision_id: 'd', linked_type, linked_id, created_by: 'u', created_at: '' });
const el = (id: string, element_type: string, name: string) => ({ element_id: id, element_type, name, parent_id: null, attributes: {}, exists_delta_id: id }) as ElementsHeadRow;
const br = (id: string) => ({ id, title: id, name: id, intent: 'explore', status: 'draft' }) as BranchRow;

describe('buildDecisionAdrExportInput (shared by the decision page and the project pack)', () => {
  it('resolves concerns (capabilities first), options with their ratings, and the recorded reasons', () => {
    const input = buildDecisionAdrExportInput({
      decision,
      links: [link('element', 'sys'), link('element', 'cap'), link('branch', 'b1'), link('branch', 'b2'), link('element', 'gone')],
      linkedElementsById: new Map([
        ['sys', el('sys', 'system', 'Ledger')],
        ['cap', el('cap', 'capability', 'Finance')],
      ]),
      linkedBranchesById: new Map([
        ['b1', br('b1')],
        ['b2', br('b2')],
      ]),
      args: [{ id: 'a', decision_id: 'd', stance: 'for', body: 'Cheaper.', author: 'u', created_at: '' }],
      ratings: [{ decision_id: 'd', branch_id: 'b1', criterion: 'cost', level: 'favourable', note: null, rated_by: 'u', rated_at: '' }],
      whatChangesRows: [],
      ownerName: 'Sam',
    });
    expect(input.concerns).toEqual([
      { name: 'Finance', typeLabel: 'capability' },
      { name: 'Ledger', typeLabel: 'system' },
    ]);
    expect(input.options.map((o) => [o.branch.id, o.isChosen, o.ratings.length])).toEqual([
      ['b1', true, 1],
      ['b2', false, 0],
    ]);
    expect(input.reasons).toBe('Cheaper.');
    expect(input.ownerName).toBe('Sam');
  });
});
