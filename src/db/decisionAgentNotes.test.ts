import { describe, expect, it } from 'vitest';
import { agentForLens } from '../contracts/decisionAgentNote';
import { noteFromRow } from './decisionAgentNotes';
import type { DecisionAgentNoteRow } from './types';

const row: DecisionAgentNoteRow = {
  id: 'note-1',
  decision_id: 'dec-1',
  branch_id: null,
  lens: 'cyber',
  agent: 'steward',
  suggested_question: 'Who has checked the data?',
  question: 'Who has checked the customer data carried?',
  based_on: 'element',
  based_on_label: 'Billing',
  input_hash: 'a'.repeat(64),
  run_id: 'run-1',
  kept_by: 'user-1',
  kept_at: '2026-11-21T09:00:00Z',
};

describe('decision agent notes', () => {
  it('maps a row to the contract, keeping the original wording beside the edit', () => {
    expect(noteFromRow(row)).toEqual({
      id: 'note-1',
      decisionId: 'dec-1',
      branchId: null,
      lens: 'cyber',
      agent: 'steward',
      suggestedQuestion: 'Who has checked the data?',
      question: 'Who has checked the customer data carried?',
      basedOn: 'element',
      basedOnLabel: 'Billing',
      inputHash: 'a'.repeat(64),
      runId: 'run-1',
      keptBy: 'user-1',
      keptAt: '2026-11-21T09:00:00Z',
    });
  });

  it('binds the lens to its agent', () => {
    expect(agentForLens('challenge')).toBe('challenger');
    expect(agentForLens('cyber')).toBe('steward');
    expect(agentForLens('data')).toBe('steward');
  });
});
