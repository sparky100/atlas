import { describe, expect, it } from 'vitest';
import type { Delta } from '../../contracts/delta';
import type { BranchRow, DecisionRow, EvidenceRow, ProjectRow } from '../../db/types';
import { buildProjectPackMarkdown, demoteHeadings, projectPackFilename, type ProjectPackInput } from './projectPack';

function project(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'p',
    org_id: 'o',
    model_id: 'm',
    title: 'Replace the CRM',
    purpose: 'The CRM is out of support.',
    owner_id: 'u',
    status: 'active',
    start_date: '2026-10-01',
    target_date: '2027-03-31',
    source_finding_key: null,
    closed_by: null,
    closed_at: null,
    close_reason: null,
    created_by: 'u',
    created_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function decision(overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    id: 'd1',
    org_id: 'o',
    model_id: 'm',
    title: 'Which CRM?',
    statement: '',
    status: 'proposed',
    owner_id: 'u',
    needed_by: null,
    source_finding_key: null,
    lens_map_url: null,
    decided_by: null,
    decided_at: null,
    cancel_reason: null,
    branch_id: null,
    superseded_decision_id: null,
    project_id: 'p',
    created_by: 'u',
    created_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function branch(overrides: Partial<BranchRow> = {}): BranchRow {
  return {
    id: 'b1',
    org_id: 'o',
    model_id: 'm',
    name: 'new-crm',
    kind: 'change',
    status: 'draft',
    base_commit_id: 'c1',
    head_commit_id: 'c2',
    shared_for_review: false,
    title: 'Bring in the new CRM',
    description: null,
    target_date: '2027-01-31',
    split_from: null,
    created_by: 'u',
    updated_at: '2026-10-01T00:00:00Z',
    cancel_reason: null,
    cancelled_at: null,
    cancelled_by: null,
    dismissed_identity_pairs: [],
    intent: 'propose',
    project_id: 'p',
    ...overrides,
  };
}

const CREATE: Delta = { kind: 'element.create', id: 'x', elementId: 'e1', elementType: 'system', name: 'New CRM', parentId: null, attributes: { lifecycleStatus: 'planned', isExternal: false }, sourceId: 's', confidence: 1 };

const EVIDENCE: EvidenceRow = { id: 'ev', org_id: 'o', model_id: 'm', kind: 'link', pointer: 'https://example.org/business-case', description: 'Business case', source_id: null, added_by: 'u', added_at: '2026-10-02T09:00:00Z' };

function input(overrides: Partial<ProjectPackInput> = {}): ProjectPackInput {
  return {
    modelName: 'Acme',
    date: '2026-10-02',
    project: project(),
    ownerName: 'Sam',
    scope: [{ name: 'Customer management', typeLabel: 'capability' }],
    touchedNotDeclared: [],
    declaredNotTouched: [],
    decisions: [],
    constrainingDecisions: [],
    changes: [],
    evidence: [],
    ...overrides,
  };
}

describe('demoteHeadings', () => {
  it('pushes every heading down, capped at h6, and leaves other lines alone', () => {
    expect(demoteHeadings('# ADR: X\n\n## Context\n\nText #1\n##### Deep', 2)).toBe('### ADR: X\n\n#### Context\n\nText #1\n###### Deep');
  });
});

describe('buildProjectPackMarkdown (F13 step 2)', () => {
  it('opens with the title, stamp, status, owner, dates and progress, then purpose and scope', () => {
    const md = buildProjectPackMarkdown(input());
    expect(md).toContain('# Project pack: Replace the CRM');
    expect(md).toContain('Acme · exported 2026-10-02 from Atlas');
    expect(md).toContain('**Status:** Active');
    expect(md).toContain('**Owner:** Sam');
    expect(md).toContain('**Target:** 2027-03-31');
    expect(md).toContain('**Progress:** 0 open changes · 0 merged · 0 open decisions · 0 decided');
    expect(md).toContain('## Purpose\n\nThe CRM is out of support.');
    expect(md).toContain('## Scope\n\n- Customer management (capability)');
  });

  it('says plainly when a section is empty, rather than leaving it out', () => {
    const md = buildProjectPackMarkdown(input({ project: project({ purpose: '' }), scope: [] }));
    expect(md).toContain('No purpose recorded.');
    expect(md).toContain('No scope declared.');
    expect(md).toContain('No decisions in this project.');
    expect(md).toContain('No changes in this project.');
    expect(md).toContain('No evidence attached.');
  });

  it('notes the gap between declared scope and what the changes touch', () => {
    const md = buildProjectPackMarkdown(input({ touchedNotDeclared: ['Billing'], declaredNotTouched: ['Customer management'] }));
    expect(md).toContain("**Touched by the project's changes but not in the declared scope:** Billing");
    expect(md).toContain('**In the declared scope but not touched by any change yet:** Customer management');
  });

  it('nests each decision ADR under the decision log, and lists constraining decisions', () => {
    const md = buildProjectPackMarkdown(
      input({
        decisions: [{ decision: decision(), adrMarkdown: '# ADR: Which CRM?\n\n## Decision\n\nNot yet decided.\n' }],
        constrainingDecisions: [decision({ id: 'd2', title: 'Cloud first', status: 'accepted', decided_at: '2026-06-01T00:00:00Z' })],
      }),
    );
    expect(md).toContain('## Decision log\n\n### ADR: Which CRM?\n\n#### Decision\n\nNot yet decided.');
    expect(md).toContain('### Decisions that constrain this project\n\n- Cloud first (accepted, decided 2026-06-01)');
    expect(md).toContain('1 open decision ·');
  });

  it("summarises each change's target state: stage, target date, the gist, capabilities and every edit", () => {
    const md = buildProjectPackMarkdown(
      input({
        changes: [
          {
            branch: branch(),
            summary: {
              description: 'Created New CRM',
              subjects: [{ subjectType: 'element', elementType: 'system', subjectId: 'e1', name: 'New CRM', deltas: [CREATE] }],
              affectedCapabilities: [
                {
                  capability: { element_id: 'cap', element_type: 'capability', name: 'Customer management', parent_id: null, attributes: {}, exists_delta_id: 'dc' },
                  viaSystems: [{ element_id: 'e1', element_type: 'system', name: 'New CRM', parent_id: null, attributes: {}, exists_delta_id: 'x' }],
                  reasons: [{ kind: 'edited', systemName: 'New CRM' }],
                },
              ],
              affectedValueStreams: [],
              projectScopeIds: null,
            },
          },
        ],
      }),
    );
    expect(md).toContain('### Proposing: Bring in the new CRM');
    expect(md).toContain('**Stage:** Chosen design · **Status:** draft · **Target date:** 2027-01-31');
    expect(md).toContain('Created New CRM');
    expect(md).toContain('- Customer management (New CRM edited)');
    expect(md).toContain('- **New CRM** — Created — "New CRM"');
  });

  it("says so when a change has no edits, or its history couldn't be read", () => {
    const md = buildProjectPackMarkdown(
      input({
        changes: [
          { branch: branch(), summary: { description: 'No changes yet', subjects: [], affectedCapabilities: [], affectedValueStreams: [], projectScopeIds: null } },
          { branch: branch({ id: 'b2', title: 'Other' }), summary: null },
        ],
      }),
    );
    expect(md).toContain('No edits yet — this change matches main.');
    expect(md).toContain("This change's history couldn't be read");
  });

  it('lists evidence with its kind, link, description and date', () => {
    const md = buildProjectPackMarkdown(input({ evidence: [EVIDENCE] }));
    expect(md).toContain('## Evidence\n\n- Link: <https://example.org/business-case> — Business case (added 2026-10-02)');
  });

  it('records how a closed project ended', () => {
    const md = buildProjectPackMarkdown(input({ project: project({ status: 'closed', closed_at: '2027-04-01T10:00:00Z', close_reason: 'Delivered' }) }));
    expect(md).toContain('**Closed:** 2027-04-01 — Delivered');
  });
});

describe('projectPackFilename', () => {
  it('model, project and date, safe on every OS', () => {
    expect(projectPackFilename('Acme Housing', 'Replace the CRM / phase 1', '2026-10-02', 'md')).toBe('acme-housing-replace-the-crm-phase-1-pack-2026-10-02.md');
  });
});
