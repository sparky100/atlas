import { describe, expect, it } from 'vitest';
import type { BranchRow, DecisionRow } from '../../db/types';
import { exportDecisionAsAdrMarkdown } from './exportDecisionAsAdr';

function makeDecision(overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    id: 'dec-1',
    org_id: 'org-1',
    model_id: 'model-1',
    title: 'Replace Ledger Service?',
    statement: 'Ledger Service needs a real replacement plan.',
    status: 'proposed',
    owner_id: 'user-1',
    needed_by: null,
    source_finding_key: null,
    lens_map_url: null,
    decided_by: null,
    decided_at: null,
    branch_id: null,
    superseded_decision_id: null,
    created_by: 'user-1',
    created_at: '2026-09-13T00:00:00Z',
    ...overrides,
  };
}

function makeBranch(overrides: Partial<BranchRow> = {}): BranchRow {
  return {
    id: 'branch-1',
    org_id: 'org-1',
    model_id: 'model-1',
    name: 'option-a',
    kind: 'change',
    status: 'draft',
    base_commit_id: 'commit-1',
    head_commit_id: 'commit-1',
    shared_for_review: false,
    title: 'Option A',
    description: null,
    target_date: null,
    split_from: null,
    created_by: 'user-1',
    updated_at: '2026-09-13T00:00:00Z',
    cancel_reason: null,
    cancelled_at: null,
    cancelled_by: null,
    dismissed_identity_pairs: [],
    intent: 'explore',
    ...overrides,
  };
}

describe('exportDecisionAsAdrMarkdown', () => {
  it('renders a proposed decision with no options as "Not yet decided", no Options section', () => {
    const markdown = exportDecisionAsAdrMarkdown({ decision: makeDecision(), ownerName: 'Alice', options: [], reasons: null });
    expect(markdown).toContain('# ADR: Replace Ledger Service?');
    expect(markdown).toContain('**Status:** Proposed');
    expect(markdown).toContain('**Owner:** Alice');
    expect(markdown).toContain('Ledger Service needs a real replacement plan.');
    expect(markdown).not.toContain('## Options considered');
    expect(markdown).toContain('Not yet decided.');
  });

  it('omits needed-by and lens-map lines when absent, includes them when set', () => {
    const withoutExtras = exportDecisionAsAdrMarkdown({ decision: makeDecision(), ownerName: 'Alice', options: [], reasons: null });
    expect(withoutExtras).not.toContain('**Needed by:**');
    expect(withoutExtras).not.toContain('**Lens map:**');

    const withExtras = exportDecisionAsAdrMarkdown({
      decision: makeDecision({ needed_by: '2026-10-01', lens_map_url: 'https://lens.example/map/1' }),
      ownerName: 'Alice',
      options: [],
      reasons: null,
    });
    expect(withExtras).toContain('**Needed by:** 2026-10-01');
    expect(withExtras).toContain('**Lens map:** https://lens.example/map/1');
  });

  it('lists every option, marking the chosen one and every cancelled one distinctly', () => {
    const chosen = makeBranch({ id: 'branch-b', title: 'Option B', intent: 'propose' });
    const cancelledOne = makeBranch({ id: 'branch-a', title: 'Option A', status: 'cancelled', cancel_reason: 'Not chosen: see decision dec-1' });
    const cancelledTwo = makeBranch({ id: 'branch-c', title: 'Option C', status: 'cancelled' });
    const markdown = exportDecisionAsAdrMarkdown({
      decision: makeDecision({ status: 'accepted', decided_at: '2026-09-14', branch_id: 'branch-b' }),
      ownerName: 'Alice',
      options: [
        { branch: cancelledOne, isChosen: false },
        { branch: chosen, isChosen: true },
        { branch: cancelledTwo, isChosen: false },
      ],
      reasons: 'Option B is the only one that adds the replacement capacity.',
    });
    expect(markdown).toContain('## Options considered');
    expect(markdown).toContain('- **Proposing: Option B** — chosen');
    expect(markdown).toContain('- Exploring: Option A — not chosen');
    expect(markdown).toContain('- Exploring: Option C — not chosen');
    expect(markdown).toContain('**Status:** Accepted — decided 2026-09-14');
    expect(markdown).toContain('We will Proposing: Option B.');
    expect(markdown).toContain('Option B is the only one that adds the replacement capacity.');
  });

  it('names the accepted decision as decided even with no reasons row yet loaded', () => {
    const chosen = makeBranch({ id: 'branch-b', title: 'Option B', intent: 'propose' });
    const markdown = exportDecisionAsAdrMarkdown({
      decision: makeDecision({ status: 'accepted', branch_id: 'branch-b' }),
      ownerName: 'Alice',
      options: [{ branch: chosen, isChosen: true }],
      reasons: null,
    });
    expect(markdown).toContain('We will Proposing: Option B.');
    expect(markdown.trim().endsWith('We will Proposing: Option B.')).toBe(true);
  });
});
