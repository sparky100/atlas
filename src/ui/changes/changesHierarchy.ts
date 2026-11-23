import type { UUID } from '../../contracts/delta';
import type { BranchRow, DecisionOptionRow, DecisionRow, ProjectRow } from '../../db/types';

export interface DecisionOptionItem {
  /** The candidate identity, or the branch id for a legacy option with no candidate row. */
  id: UUID;
  decisionId: UUID;
  title: string;
  /** Null while the candidate has no delivery branch. */
  branch: BranchRow | null;
}

export interface DecisionBlock {
  decision: DecisionRow;
  /** The decision's candidates, branchless ones included. */
  options: DecisionOptionItem[];
}

export interface ProjectBlock {
  project: ProjectRow;
  decisions: DecisionBlock[];
  /** Open changes linked straight to the project, not through a decision. */
  changes: BranchRow[];
}

/**
 * The Changes list's shape (Simon, 2026-11-19): project, then decision, then
 * candidate/change. A project holds its decisions (each with its candidates)
 * and any change linked straight to it. A decision outside a project holds its
 * candidates. Only a change in neither is listed on its own. Each candidate or
 * change appears once.
 */
export interface ChangesHierarchy {
  projects: ProjectBlock[];
  decisions: DecisionBlock[];
  standalone: BranchRow[];
}

const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title);
const byBranchTitle = (a: BranchRow, b: BranchRow) => (a.title ?? a.name).localeCompare(b.title ?? b.name);

export function buildChangesHierarchy(
  openBranches: readonly BranchRow[],
  decisions: readonly DecisionRow[],
  projects: readonly ProjectRow[],
  options: readonly DecisionOptionRow[],
): ChangesHierarchy {
  const decisionById = new Map(decisions.map((d) => [d.id, d]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const branchById = new Map(openBranches.map((b) => [b.id, b]));
  const decisionOfBranch = new Map<UUID, UUID>();
  for (const option of options) {
    if (option.branch_id !== null && decisionById.has(option.decision_id)) decisionOfBranch.set(option.branch_id, option.decision_id);
  }

  const projectBlocks = new Map<UUID, ProjectBlock>();
  const decisionBlocksInProject = new Map<UUID, DecisionBlock>();
  const looseDecisionBlocks = new Map<UUID, DecisionBlock>();
  const standalone: BranchRow[] = [];

  const blockFor = (decision: DecisionRow, into: Map<UUID, DecisionBlock>): DecisionBlock => {
    const existing = into.get(decision.id);
    if (existing) return existing;
    const created = { decision, options: [] };
    into.set(decision.id, created);
    return created;
  };

  const addToParent = (decision: DecisionRow, item: DecisionOptionItem): void => {
    const project = projectById.get(decision.project_id ?? '');
    if (project !== undefined) {
      const block = projectBlocks.get(project.id) ?? { project, decisions: [], changes: [] };
      projectBlocks.set(project.id, block);
      const decisionBlock = blockFor(decision, decisionBlocksInProject);
      decisionBlock.options.push(item);
      if (!block.decisions.includes(decisionBlock)) block.decisions.push(decisionBlock);
      return;
    }
    blockFor(decision, looseDecisionBlocks).options.push(item);
  };

  // Candidates are listed even when they have never had a delivery branch.
  for (const option of options) {
    const decision = decisionById.get(option.decision_id);
    if (decision === undefined) continue;
    const branch = option.branch_id === null ? null : (branchById.get(option.branch_id) ?? null);
    // Branchless candidates belong here only while the decision is open. A
    // worked/chosen option appears only while its own change is open.
    if (branch === null && (option.branch_id !== null || decision.status !== 'proposed')) continue;
    addToParent(decision, {
      id: option.id,
      decisionId: decision.id,
      title: option.title,
      branch,
    });
  }

  // A legacy branch-linked option with no candidate row still belongs under
  // its decision once. Open changes with no decision are project changes or
  // standalone changes.
  const representedBranches = new Set(options.flatMap((o) => (o.branch_id === null ? [] : [o.branch_id])));
  for (const branch of openBranches) {
    if (representedBranches.has(branch.id)) continue;
    const decision = decisionById.get(decisionOfBranch.get(branch.id) ?? '');
    if (decision !== undefined) {
      addToParent(decision, { id: branch.id, decisionId: decision.id, title: branch.title ?? branch.name, branch });
      continue;
    }
    const project = projectById.get(branch.project_id ?? '');
    if (project !== undefined) {
      const block = projectBlocks.get(project.id) ?? { project, decisions: [], changes: [] };
      projectBlocks.set(project.id, block);
      block.changes.push(branch);
    } else {
      standalone.push(branch);
    }
  }

  const sortDecisions = (blocks: DecisionBlock[]) => {
    for (const b of blocks) b.options.sort(byTitle);
    return blocks.sort((a, b) => a.decision.title.localeCompare(b.decision.title));
  };
  const projectsOut = [...projectBlocks.values()].sort((a, b) => a.project.title.localeCompare(b.project.title));
  for (const p of projectsOut) {
    sortDecisions(p.decisions);
    p.changes.sort(byBranchTitle);
  }
  return { projects: projectsOut, decisions: sortDecisions([...looseDecisionBlocks.values()]), standalone };
}
