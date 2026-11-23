import type { UUID } from '../../contracts/delta';
import type { BranchRow, DecisionOptionRow, DecisionRow, ProjectRow } from '../../db/types';

/**
 * Home's "My work" card (Simon, 2026-11-19): projects first, then decisions,
 * then changes. Each of the viewer's open changes is shown once, under the
 * highest thing it belongs to: its project if it has one, else its decision
 * (it is one of that decision's options), else on its own. A decision with
 * no project is listed once, however many options of the viewer's it holds.
 * Every row says what it sits under, so a bare "Stay as we are" never
 * appears without its decision.
 */
export interface MyWorkRow {
  key: string;
  kind: 'project' | 'decision' | 'change';
  title: string;
  /** The viewer's open changes folded into this row. */
  changeCount: number;
  /** For a change on its own: the change's stage. For a decision or project row: null. */
  status: BranchRow['status'] | null;
  target: { kind: 'project' | 'decision' | 'change'; id: UUID };
}

export function buildMyWorkRows(
  openBranches: readonly BranchRow[],
  decisions: readonly DecisionRow[],
  projects: readonly ProjectRow[],
  options: readonly DecisionOptionRow[],
): MyWorkRow[] {
  const decisionById = new Map(decisions.map((d) => [d.id, d]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const decisionOfBranch = new Map<UUID, UUID>();
  for (const option of options) {
    if (option.branch_id !== null && !decisionOfBranch.has(option.branch_id)) decisionOfBranch.set(option.branch_id, option.decision_id);
  }

  const projectRows = new Map<UUID, MyWorkRow>();
  const decisionRows = new Map<UUID, MyWorkRow>();
  const changeRows: MyWorkRow[] = [];

  for (const branch of openBranches) {
    const decision = decisionById.get(decisionOfBranch.get(branch.id) ?? '');
    const project = projectById.get(branch.project_id ?? decision?.project_id ?? '');
    if (project) {
      const row = projectRows.get(project.id) ?? { key: `p-${project.id}`, kind: 'project', title: project.title, changeCount: 0, status: null, target: { kind: 'project', id: project.id } };
      row.changeCount += 1;
      projectRows.set(project.id, row);
    } else if (decision) {
      const row = decisionRows.get(decision.id) ?? { key: `d-${decision.id}`, kind: 'decision', title: decision.title, changeCount: 0, status: null, target: { kind: 'decision', id: decision.id } };
      row.changeCount += 1;
      decisionRows.set(decision.id, row);
    } else {
      changeRows.push({ key: `c-${branch.id}`, kind: 'change', title: branch.title ?? branch.name, changeCount: 1, status: branch.status, target: { kind: 'change', id: branch.id } });
    }
  }
  const byTitle = (a: MyWorkRow, b: MyWorkRow) => a.title.localeCompare(b.title);
  return [...[...projectRows.values()].sort(byTitle), ...[...decisionRows.values()].sort(byTitle), ...changeRows.sort(byTitle)];
}

/** The muted line under a row: what it holds, in words. */
export function myWorkDetail(row: MyWorkRow): string {
  const n = row.changeCount;
  if (row.kind === 'project') return `Project · ${String(n)} of your open change${n === 1 ? '' : 's'}`;
  if (row.kind === 'decision') return `Decision · ${String(n)} option${n === 1 ? '' : 's'} of yours, waiting to be chosen`;
  return 'Change on its own: not part of a project or decision';
}

export interface DecisionWithOptions {
  decision: DecisionRow;
  /** The candidates that are this decision's options, branchless ones included. */
  options: DecisionOptionRow[];
}

const byOptionTitle = (a: DecisionOptionRow, b: DecisionOptionRow) => a.title.localeCompare(b.title);
const byBranchTitle = (a: BranchRow, b: BranchRow) => (a.title ?? a.name).localeCompare(b.title ?? b.name);

/** The candidates inside one decision. */
export function decisionOptions(decisionId: UUID, options: readonly DecisionOptionRow[]): DecisionOptionRow[] {
  return options.filter((o) => o.decision_id === decisionId).sort(byOptionTitle);
}

/**
 * The hierarchy Project → Decision → Change (Simon, 2026-11-19). A project
 * holds its open decisions, each with its option changes underneath. A change
 * linked straight to the project, not through a decision, sits beside the
 * decisions, one level down from the project.
 */
export function projectChildren(
  projectId: UUID,
  openBranches: readonly BranchRow[],
  decisions: readonly DecisionRow[],
  options: readonly DecisionOptionRow[],
): { decisions: DecisionWithOptions[]; changes: BranchRow[] } {
  const optionIds = new Set(options.flatMap((o) => (o.branch_id === null ? [] : [o.branch_id])));
  return {
    decisions: decisions
      .filter((d) => d.project_id === projectId && d.status === 'proposed')
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((decision) => ({ decision, options: decisionOptions(decision.id, options) })),
    changes: openBranches.filter((b) => b.project_id === projectId && !optionIds.has(b.id)).sort(byBranchTitle),
  };
}
