import { describe, expect, it } from 'vitest';
import type { BranchRow, DecisionRow, ProjectRow } from '../../db/types';
import { buildWorkLists } from './workLists';

const branch = (id: string, over: Partial<BranchRow> = {}) => ({ id, kind: 'change', name: id, title: id, status: 'draft', project_id: null, ...over }) as unknown as BranchRow;
const decision = (id: string, over: Partial<DecisionRow> = {}) => ({ id, title: id, status: 'proposed', project_id: null, ...over }) as unknown as DecisionRow;
const project = (id: string, status = 'active') => ({ id, title: id, status }) as unknown as ProjectRow;

describe('buildWorkLists', () => {
  it('lists a decision only outside a project and a change only outside both', () => {
    const lists = buildWorkLists(
      [branch('alone'), branch('in-project', { project_id: 'p1' }), branch('option')],
      [decision('free'), decision('in-p', { project_id: 'p1' })],
      [project('p1'), project('done', 'closed')],
      [{ branchId: 'option', decisionId: 'free' }],
    );
    expect(lists.projects.map((p) => p.id)).toEqual(['p1']);
    expect(lists.projects[0]?.status).toBe('Active · 1 open decision · 1 open change');
    expect(lists.decisions.map((d) => d.id)).toEqual(['free']);
    expect(lists.changes.map((c) => c.id)).toEqual(['alone']);
  });
});
