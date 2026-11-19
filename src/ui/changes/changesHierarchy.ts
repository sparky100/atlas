import type { UUID } from '../../contracts/delta';
import type { DecisionOptionLink } from '../../db/decisions';
import type { BranchRow, DecisionRow, ProjectRow } from '../../db/types';

export interface DecisionBlock {
  decision: DecisionRow;
  /** The open changes that are this decision's options. */
  options: BranchRow[];
}

export interface ProjectBlock {
  project: ProjectRow;
  decisions: DecisionBlock[];
  /** Open changes linked straight to the project, not through a decision. */
  changes: BranchRow[];
}

/**
 * The Changes list's shape (Simon, 2026-11-19): project, then decision, then
 * change. A project holds its decisions (each with its option changes) and any
 * change linked straight to it. A decision outside a project holds its options.
 * Only a change in neither is listed on its own. Each open change appears once.
 * Pure, so the grouping is unit-tested on its own.
 */
export interface ChangesHierarchy {
  projects: ProjectBlock[];
  decisions: DecisionBlock[];
  standalone: BranchRow[];
}

const byTitle = (a: BranchRow, b: BranchRow) => (a.title ?? a.name).localeCompare(b.title ?? b.name);

export function buildChangesHierarchy(openBranches: readonly BranchRow[], decisions: readonly DecisionRow[], projects: readonly ProjectRow[], optionLinks: readonly DecisionOptionLink[]): ChangesHierarchy {
  const decisionById = new Map(decisions.map((d) => [d.id, d]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const decisionOfBranch = new Map<UUID, UUID>();
  for (const l of optionLinks) if (!decisionOfBranch.has(l.branchId) && decisionById.has(l.decisionId)) decisionOfBranch.set(l.branchId, l.decisionId);

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

  for (const branch of openBranches) {
    const decision = decisionById.get(decisionOfBranch.get(branch.id) ?? '');
    const project = projectById.get(branch.project_id ?? decision?.project_id ?? '');
    if (project) {
      const block = projectBlocks.get(project.id) ?? { project, decisions: [], changes: [] };
      projectBlocks.set(project.id, block);
      if (decision) {
        const decisionBlock = blockFor(decision, decisionBlocksInProject);
        decisionBlock.options.push(branch);
        if (!block.decisions.includes(decisionBlock)) block.decisions.push(decisionBlock);
      } else {
        block.changes.push(branch);
      }
    } else if (decision) {
      blockFor(decision, looseDecisionBlocks).options.push(branch);
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
    p.changes.sort(byTitle);
  }
  return { projects: projectsOut, decisions: sortDecisions([...looseDecisionBlocks.values()]), standalone };
}
