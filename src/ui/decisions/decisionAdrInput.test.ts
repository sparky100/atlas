import { describe, expect, it } from 'vitest';
import type { OptionSource } from '../../contracts/optionSource';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { BranchRow, DecisionLinkRow, DecisionOptionRow, DecisionRow } from '../../db/types';
import { buildDecisionAdrExportInput } from './decisionAdrInput';

const decision = { id: 'd', branch_id: 'b1', status: 'accepted' } as DecisionRow;
const link = (linked_type: DecisionLinkRow['linked_type'], linked_id: string): DecisionLinkRow => ({ decision_id: 'd', linked_type, linked_id, created_by: 'u', created_at: '' });
const el = (id: string, element_type: string, name: string) => ({ element_id: id, element_type, name, parent_id: null, attributes: {}, exists_delta_id: id }) as ElementsHeadRow;
const br = (id: string) => ({ id, title: id, name: id, intent: 'explore', status: 'draft' }) as BranchRow;
const option = (id: string, branch_id: string | null, title: string, summary = '') => ({ id, decision_id: 'd', branch_id, title, summary, to_weigh: '', position: 0, source: 'manual', agent: null, drafted_at: null, draft_run_id: null, edited_by: null, edited_at: null, created_by: 'u', created_at: '', updated_by: 'u', updated_at: '' }) as DecisionOptionRow;
const webSource: OptionSource = { kind: 'web', id: 's', branchId: 'b2', optionId: 'o2', citedBy: 'u', citedAt: '', url: 'https://example.com', title: 'Vendor page', publisher: null, excerpt: null, retrievedAt: '', assertion: null, checkedBy: null, checkedAt: null };

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
    expect(input.options.map((o) => [o.branch?.id, o.isChosen, o.ratings.length])).toEqual([
      ['b1', true, 1],
      ['b2', false, 0],
    ]);
    expect(input.reasons).toBe('Cheaper.');
    expect(input.ownerName).toBe('Sam');
  });

  it('reads branchless candidates, option-keyed ratings and sources by option id', () => {
    const input = buildDecisionAdrExportInput({
      decision,
      links: [link('element', 'cap')],
      linkedElementsById: new Map([['cap', el('cap', 'capability', 'Finance')]]),
      linkedBranchesById: new Map([['b1', br('b1')]]),
      options: [option('o1', 'b1', 'Hosted product'), option('o2', null, 'Build in house', 'Use the existing team.')],
      args: [],
      ratings: [
        { decision_id: 'd', branch_id: 'b1', option_id: 'o1', criterion: 'cost', level: 'favourable', note: null, rated_by: 'u', rated_at: '' },
        { decision_id: 'd', branch_id: null, option_id: 'o2', criterion: 'effort', level: 'unfavourable', note: 'Needs people.', rated_by: 'u', rated_at: '' },
      ],
      sourcesByOption: new Map([['o2', [webSource]]]),
      whatChangesRows: [],
      ownerName: 'Sam',
    });
    expect(input.options.map((o) => [o.optionId, o.branch?.id ?? null, o.status, o.ratings.length, o.sources?.length ?? 0])).toEqual([
      ['o1', 'b1', 'draft', 1, 0],
      ['o2', null, 'candidate', 1, 1],
    ]);
    expect(input.options[1]?.about).toBe('Use the existing team.');
  });
});
