import { describe, expect, it } from 'vitest';
import type { BranchRow, DecisionOptionRow, DecisionRow, ProjectRow } from '../../db/types';
import { buildChangesHierarchy } from './changesHierarchy';

const branch = (id: string, over: Partial<BranchRow> = {}) => ({ id, name: id, title: id, project_id: null, ...over }) as unknown as BranchRow;
const decision = (id: string, project_id: string | null = null) => ({ id, title: id, project_id }) as unknown as DecisionRow;
const project = (id: string) => ({ id, title: id }) as unknown as ProjectRow;
const option = (id: string, decisionId: string, branchId: string | null = null) => ({ id, decision_id: decisionId, branch_id: branchId, title: id, position: 0 }) as DecisionOptionRow;

describe('buildChangesHierarchy', () => {
  it('nests options under their decision, decisions under their project, and lists each branch once', () => {
    const h = buildChangesHierarchy(
      [branch('opt-in-project'), branch('direct', { project_id: 'p1' }), branch('opt-loose'), branch('alone'), branch('opt-p-via-decision')],
      [decision('d-in-p', 'p1'), decision('d-loose')],
      [project('p1')],
      [
        option('opt-in-project', 'd-in-p', 'opt-in-project'),
        option('opt-p-via-decision', 'd-in-p', 'opt-p-via-decision'),
        option('opt-loose', 'd-loose', 'opt-loose'),
      ],
    );
    expect(h.projects.map((p) => p.project.id)).toEqual(['p1']);
    expect(h.projects[0]?.decisions.map((d) => [d.decision.id, d.options.map((o) => o.id)])).toEqual([['d-in-p', ['opt-in-project', 'opt-p-via-decision']]]);
    expect(h.projects[0]?.changes.map((c) => c.id)).toEqual(['direct']);
    expect(h.decisions.map((d) => [d.decision.id, d.options.map((o) => o.id)])).toEqual([['d-loose', ['opt-loose']]]);
    expect(h.standalone.map((b) => b.id)).toEqual(['alone']);
  });

  it('lists a branchless candidate under its decision', () => {
    const h = buildChangesHierarchy([], [decision('d1')], [], [option('candidate', 'd1')]);
    expect(h.decisions[0]?.options).toEqual([expect.objectContaining({ id: 'candidate', branch: null })]);
  });
});
