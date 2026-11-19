import { describe, expect, it } from 'vitest';
import type { BranchRow, DecisionRow, ProjectRow } from '../../db/types';
import { buildMyWorkRows, myWorkDetail } from './myWork';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const branch = (n: number, over: Partial<BranchRow> = {}) => ({ id: id(n), name: `b${String(n)}`, title: `Change ${String(n)}`, status: 'draft', project_id: null, ...over }) as BranchRow;
const decision = (n: number, over: Partial<DecisionRow> = {}) => ({ id: id(n), title: `Decision ${String(n)}`, project_id: null, ...over }) as DecisionRow;
const project = (n: number) => ({ id: id(n), title: `Project ${String(n)}` }) as ProjectRow;

describe('buildMyWorkRows', () => {
  it('shows a change once, under its project, then its decision, else on its own', () => {
    const rows = buildMyWorkRows(
      [branch(1, { project_id: id(100) }), branch(2), branch(3), branch(4), branch(5)],
      [decision(200), decision(201, { project_id: id(100) })],
      [project(100)],
      [
        { decisionId: id(200), branchId: id(2) },
        { decisionId: id(200), branchId: id(3) },
        { decisionId: id(201), branchId: id(4) },
      ],
    );
    expect(rows.map((r) => [r.kind, r.title, r.changeCount])).toEqual([
      ['project', 'Project 100', 2],
      ['decision', 'Decision 200', 2],
      ['change', 'Change 5', 1],
    ]);
  });

  it('never lists a decision option as a bare change', () => {
    const rows = buildMyWorkRows([branch(2, { title: 'Stay as we are' })], [decision(200)], [], [{ decisionId: id(200), branchId: id(2) }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Decision 200');
    expect(myWorkDetail(rows[0] as never)).toBe('Decision · 1 option of yours, waiting to be chosen');
  });

  it('says a lone change is on its own', () => {
    const rows = buildMyWorkRows([branch(9)], [], [], []);
    expect(myWorkDetail(rows[0] as never)).toMatch(/on its own/);
  });
});
