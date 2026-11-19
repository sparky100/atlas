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
    cancel_reason: null,
    reconsider_if: null, review_by: null, stay_risk: '', stay_reason: '', baseline_branch_id: null, branch_id: null,
    superseded_decision_id: null,
    project_id: null,
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
    project_id: null,
    ...overrides,
  };
}

describe('exportDecisionAsAdrMarkdown', () => {
  it('renders a proposed decision with no options as "Not yet decided", no Options/Concerns/What-changes sections', () => {
    const markdown = exportDecisionAsAdrMarkdown({ decision: makeDecision(), ownerName: 'Alice', concerns: [], options: [], whatChangesRows: [], reasons: null });
    expect(markdown).toContain('# ADR: Replace Ledger Service?');
    expect(markdown).toContain('**Status:** Proposed');
    expect(markdown).toContain('**Owner:** Alice');
    expect(markdown).toContain('Ledger Service needs a real replacement plan.');
    expect(markdown).not.toContain('## Options considered');
    expect(markdown).not.toContain('## Concerns');
    expect(markdown).not.toContain('## What changes');
    expect(markdown).toContain('Not yet decided.');
  });

  it('omits needed-by and lens-map lines when absent, includes them when set', () => {
    const withoutExtras = exportDecisionAsAdrMarkdown({ decision: makeDecision(), ownerName: 'Alice', concerns: [], options: [], whatChangesRows: [], reasons: null });
    expect(withoutExtras).not.toContain('**Needed by:**');
    expect(withoutExtras).not.toContain('**Lens map:**');

    const withExtras = exportDecisionAsAdrMarkdown({
      decision: makeDecision({ needed_by: '2026-10-01', lens_map_url: 'https://lens.example/map/1' }),
      ownerName: 'Alice',
      concerns: [],
      options: [],
      whatChangesRows: [],
      reasons: null,
    });
    expect(withExtras).toContain('**Needed by:** 2026-10-01');
    expect(withExtras).toContain('**Lens map:** https://lens.example/map/1');
  });

  it('lists every declared concern with its type', () => {
    const markdown = exportDecisionAsAdrMarkdown({
      decision: makeDecision(),
      ownerName: 'Alice',
      concerns: [
        { name: 'Outage Management', typeLabel: 'capability' },
        { name: 'PM', typeLabel: 'system' },
      ],
      options: [],
      whatChangesRows: [],
      reasons: null,
    });
    expect(markdown).toContain('## Concerns');
    expect(markdown).toContain('- Outage Management (capability)');
    expect(markdown).toContain('- PM (system)');
  });

  it('lists every option, marking the chosen one and every cancelled one distinctly, each with its own ratings and notes', () => {
    const chosen = makeBranch({ id: 'branch-b', title: 'Option B', intent: 'propose' });
    const cancelledOne = makeBranch({ id: 'branch-a', title: 'Option A', status: 'cancelled', cancel_reason: 'Not chosen: see decision dec-1' });
    const cancelledTwo = makeBranch({ id: 'branch-c', title: 'Option C', status: 'cancelled' });
    const markdown = exportDecisionAsAdrMarkdown({
      decision: makeDecision({ status: 'accepted', decided_at: '2026-09-14T10:32:07.123456+00:00', branch_id: 'branch-b' }),
      ownerName: 'Alice',
      concerns: [],
      options: [
        { branch: cancelledOne, isChosen: false, ratings: [{ criterionLabel: 'Cost', levelLabel: 'High', note: null }] },
        { branch: chosen, isChosen: true, ratings: [{ criterionLabel: 'Cost', levelLabel: 'Low', note: 'Cheaper than the incumbent.' }] },
        { branch: cancelledTwo, isChosen: false, ratings: [] },
      ],
      whatChangesRows: [],
      reasons: 'Option B is the only one that adds the replacement capacity.',
    });
    expect(markdown).toContain('## Options considered');
    expect(markdown).toContain('- **Proposing: Option B** — chosen');
    expect(markdown).toContain('  - Cost: Low — Cheaper than the incumbent.');
    expect(markdown).toContain('- Exploring: Option A — not chosen');
    expect(markdown).toContain('  - Cost: High');
    expect(markdown).toContain('- Exploring: Option C — not chosen');
    expect(markdown).toContain('**Status:** Accepted — decided 2026-09-14\n');
    expect(markdown).toContain('Chosen option: **Option B**.');
    expect(markdown).toContain('Option B is the only one that adds the replacement capacity.');
  });

  it('names the accepted decision as decided even with no reasons row yet loaded', () => {
    const chosen = makeBranch({ id: 'branch-b', title: 'Option B', intent: 'propose' });
    const markdown = exportDecisionAsAdrMarkdown({
      decision: makeDecision({ status: 'accepted', branch_id: 'branch-b' }),
      ownerName: 'Alice',
      concerns: [],
      options: [{ branch: chosen, isChosen: true, ratings: [] }],
      whatChangesRows: [],
      reasons: null,
    });
    expect(markdown).toContain('Chosen option: **Option B**.');
    expect(markdown.trim().endsWith('Chosen option: **Option B**.')).toBe(true);
  });

  it('writes what would make the decision be reconsidered, with the review date, only when recorded', () => {
    const chosen = makeBranch({ id: 'branch-b', title: 'Option B', intent: 'propose' });
    const base = { ownerName: 'Alice', concerns: [], options: [{ branch: chosen, isChosen: true, ratings: [] }], whatChangesRows: [], reasons: 'Cheapest.' };
    const withIt = exportDecisionAsAdrMarkdown({ ...base, decision: makeDecision({ status: 'accepted', branch_id: 'branch-b', reconsider_if: 'Vendor price rises', review_by: '2027-03-01' }) });
    expect(withIt).toContain('Reconsider if: Vendor price rises (look again by 2027-03-01)');
    const without = exportDecisionAsAdrMarkdown({ ...base, decision: makeDecision({ status: 'accepted', branch_id: 'branch-b' }) });
    expect(without).not.toContain('Reconsider if');
  });

  it('renders the What-changes evidence rows, naming each option by its own label, with the "Current (main)" value first', () => {
    const optionA = makeBranch({ id: 'branch-a', title: 'Option A' });
    const markdown = exportDecisionAsAdrMarkdown({
      decision: makeDecision(),
      ownerName: 'Alice',
      concerns: [],
      options: [{ branch: optionA, isChosen: false, ratings: [] }],
      whatChangesRows: [
        {
          id: 'element:pm:outcome',
          groupLabel: 'PM',
          rowLabel: 'Outcome',
          main: { display: 'unchanged', changed: false },
          options: new Map([['branch-a', { display: 'replaced by Hana equivalent', changed: true }]]),
          anyChanged: true,
        },
      ],
      reasons: null,
    });
    expect(markdown).toContain('## What changes (evidence)');
    expect(markdown).toContain('- **PM — Outcome** — Current (main): unchanged; Exploring: Option A: replaced by Hana equivalent');
  });

  it('omits the What-changes section entirely when nothing differs', () => {
    const markdown = exportDecisionAsAdrMarkdown({ decision: makeDecision(), ownerName: 'Alice', concerns: [], options: [], whatChangesRows: [], reasons: null });
    expect(markdown).not.toContain('## What changes');
  });

  it('writes up a cancelled decision as cancelled, with its date and reason', () => {
    const markdown = exportDecisionAsAdrMarkdown({
      decision: makeDecision({ status: 'rejected', decided_by: 'user-1', decided_at: '2026-10-03T08:00:00.000000+00:00', cancel_reason: 'The vendor withdrew the product.' }),
      ownerName: 'Alice',
      concerns: [],
      options: [],
      whatChangesRows: [],
      reasons: null,
    });
    expect(markdown).toContain('**Status:** Cancelled — 2026-10-03\n');
    expect(markdown).toContain('## Decision\n\nCancelled without choosing an option: The vendor withdrew the product.');
    expect(markdown).not.toContain('Not yet decided');
  });
  it('lists the principles it follows and departs from (with the reason), and prints nothing when there are none', () => {
    const base = { decision: makeDecision(), ownerName: 'Alice', concerns: [], options: [], whatChangesRows: [], reasons: null };
    const withPrinciples = exportDecisionAsAdrMarkdown({
      ...base,
      principles: [
        { title: 'Reuse before buying', stance: 'follows', reason: '' },
        { title: 'One main system per capability', stance: 'departs', reason: 'Two regions run separate stacks until 2028.' },
      ],
    });
    expect(withPrinciples).toContain('## Principles\n\n- Follows **Reuse before buying**\n- Departs from **One main system per capability** — Two regions run separate stacks until 2028.\n');
    expect(exportDecisionAsAdrMarkdown({ ...base, principles: [] })).not.toContain('## Principles');
    expect(exportDecisionAsAdrMarkdown(base)).not.toContain('## Principles');
  });
  it('lists the goals the concerned capabilities serve, and prints nothing when there are none', () => {
    const base = { decision: makeDecision(), ownerName: 'Alice', concerns: [], options: [], whatChangesRows: [], reasons: null };
    expect(exportDecisionAsAdrMarkdown({ ...base, goalsServed: ['Cut run cost', 'Serve citizens online'] })).toContain('## Goals served\n\n- Cut run cost\n- Serve citizens online\n');
    expect(exportDecisionAsAdrMarkdown({ ...base, goalsServed: [] })).not.toContain('## Goals served');
    expect(exportDecisionAsAdrMarkdown(base)).not.toContain('## Goals served');
  });
});
