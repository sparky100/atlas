import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../contracts/rows';
import type { BranchRow, DecisionRow } from '../db/types';
import type { AskModelRequest } from './askLoop';
import { handleReview, type ReviewDeps } from './reviewHandler';
import { buildReviewerDigest } from './reviewDigest';
import type { ModelSnapshot, ToolContext } from './types';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const decision = { id: id(1), org_id: id(2), model_id: id(3), status: 'proposed', title: 'How do we quote new connections?', statement: 'Quotes should take two days.', needed_by: '2027-01-01', branch_id: null, reconsider_if: null, review_by: null } as DecisionRow;
const option = { id: id(4), title: 'Replace', name: 'Replace', description: 'Move quotes to a hosted product.' } as BranchRow;
const concern = { element_id: id(5), element_type: 'system', name: 'Quote Tool', parent_id: null, attributes: { criticality: 'high', annualRunCost: 'over_5m' }, exists_delta_id: id(6) } as ElementsHeadRow;
const snapshot: ModelSnapshot = { elements: [concern], relationships: [], aliases: new Map() };
const body = { decisionId: decision.id, lens: 'challenge' };
const answer = JSON.stringify({ notes: [{ note: 'The hosted option needs an interface.', basedOn: 'Option 1: Replace', question: 'Who has checked its fit with billing?' }] });

function deps(overrides: Partial<ReviewDeps> = {}) {
  const requests: AskModelRequest[] = [];
  const choices: { lens: string; runId: string; shareCost: boolean }[] = [];
  const base: ReviewDeps = {
    loadDecision: () => Promise.resolve(decision),
    loadModel: () => Promise.resolve({ id: decision.model_id, orgId: decision.org_id, name: 'Test' }),
    callerRole: () => Promise.resolve('contributor'),
    settings: () => Promise.resolve({ assistantEnabled: true, agentsEnabled: true, keySet: true, shareCost: false }),
    mainCommit: () => Promise.resolve(id(7)),
    loadSavedReview: (row) => Promise.resolve({ decision: row, options: [option], ratings: [{ branch_id: option.id, criterion: 'cost', level: 'unfavourable', note: 'Cost secret' }, { branch_id: option.id, criterion: 'effort', level: 'acceptable', note: 'Configuration needed' }], concerns: [concern], concernRelationships: [], principles: [{ title: 'Reuse', stance: 'follows', reason: 'Already in the estate' }], goals: ['Quicker quotes'] }),
    createContext: (_model, _commit, shareCost) => {
      choices.push({ lens: '', runId: '', shareCost });
      return { snapshot: () => Promise.resolve(snapshot) } as ToolContext;
    },
    newRunId: () => id(8),
    createClient: (_org, runId, lens) => {
      choices.push({ lens, runId, shareCost: false });
      return { complete: (request) => { requests.push(request); return Promise.resolve({ text: answer, stopReason: 'end_turn', inputTokens: 14, outputTokens: 21 }); } };
    },
    hash: () => Promise.resolve('a'.repeat(64)),
  };
  return { deps: { ...base, ...overrides }, requests, choices };
}

describe('review-agent boundary', () => {
  it('sends only saved, relevant facts; excludes cost and identity on the actual outgoing request', async () => {
    const d = deps();
    const result = await handleReview(d.deps, body);
    expect(result).toMatchObject({ status: 'done', inputTokens: 14, outputTokens: 21, notes: [{ basedOn: { kind: 'option', branchId: option.id } }] });
    const actual = JSON.stringify(d.requests[0]);
    expect(actual).toContain('Quote Tool');
    expect(actual).toContain('Configuration needed');
    expect(actual).toContain('Quicker quotes');
    expect(actual).not.toContain('Cost secret');
    expect(actual).not.toContain('annualRunCost');
    expect(actual).not.toContain(decision.org_id);
    expect(actual).not.toContain(decision.model_id);
    expect(actual).not.toContain(option.id);
    expect(d.requests[0]?.tools).toEqual([]);
    expect(d.choices).toContainEqual({ lens: 'challenge', runId: id(8), shareCost: false });
  });

  it('blocks viewers, disabled agents, a missing own key and cross-org model without calling the provider', async () => {
    const cases: Partial<ReviewDeps>[] = [
      { callerRole: () => Promise.resolve('viewer') },
      { settings: () => Promise.resolve({ assistantEnabled: false, agentsEnabled: true, keySet: true, shareCost: false }) },
      { settings: () => Promise.resolve({ assistantEnabled: true, agentsEnabled: true, keySet: false, shareCost: false }) },
      { loadModel: () => Promise.resolve({ id: id(3), orgId: id(99), name: 'Other' }) },
    ];
    for (const item of cases) {
      const d = deps(item);
      expect((await handleReview(d.deps, body)).status).not.toBe('done');
      expect(d.requests).toHaveLength(0);
    }
  });

  it('blocks money in free text until an owner shares cost; the cost rating then follows that switch', async () => {
    const costly = { ...decision, statement: 'Budget £500,000.' };
    const blocked = deps({ loadDecision: () => Promise.resolve(costly) });
    expect((await handleReview(blocked.deps, body)).status).toBe('cost_blocked');
    expect(blocked.requests).toHaveLength(0);
    const shared = deps({ loadDecision: () => Promise.resolve(costly), settings: () => Promise.resolve({ assistantEnabled: true, agentsEnabled: true, keySet: true, shareCost: true }) });
    expect((await handleReview(shared.deps, body)).status).toBe('done');
    expect(JSON.stringify(shared.requests[0])).toContain('Cost secret');
    expect(shared.choices[0]?.shareCost).toBe(true);
  });

  it('keeps only grounded questions and never turns a reviewer into a clearance', async () => {
    const output = JSON.stringify({ notes: [
      { note: 'This is compliant.', basedOn: 'Quote Tool', question: 'Is this approved?' },
      { note: 'A missing assumption.', basedOn: 'Invented record', question: 'What evidence supports this?' },
      { note: 'The interface needs checking.', basedOn: 'Quote Tool', question: 'Who checked the data it carries?' },
    ] });
    const d = deps({ createClient: () => ({ complete: () => Promise.resolve({ text: output, inputTokens: 1, outputTokens: 1 }) }) });
    expect(await handleReview(d.deps, body)).toMatchObject({ status: 'done', dropped: 1, notes: [{ basedOn: { kind: 'none' } }, { basedOn: { kind: 'element', elementId: concern.element_id } }] });
  });

  it('treats cut-off responses as incomplete, even if they contain valid JSON', async () => {
    const d = deps({ createClient: () => ({ complete: () => Promise.resolve({ text: answer, stopReason: 'max_tokens', inputTokens: 1, outputTokens: 2 }) }) });
    expect(await handleReview(d.deps, body)).toMatchObject({ status: 'incomplete', inputTokens: 1, outputTokens: 2 });
  });
});

it('the digest is an explicit allowlist: a new attribute does not reach the provider', () => {
  const secret = { ...concern, attributes: { annualRunCost: 'over_5m', annualBudget: '£1m', criticality: 'high' } };
  const d = buildReviewerDigest({ decision, options: [option], ratings: [], concerns: [secret], snapshot: { ...snapshot, elements: [secret] }, principles: [], goals: [], shareCost: false });
  expect(d.text).toContain('criticality: high');
  expect(d.text).not.toContain('annualBudget');
  expect(d.text).not.toContain('annualRunCost');
});
