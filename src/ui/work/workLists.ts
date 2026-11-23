import type { UUID } from '../../contracts/delta';
import type { BranchRow, DecisionOptionRow, DecisionRow, ProjectRow } from '../../db/types';
import { projectIsOpen, projectStatusLabel } from '../projects/projectModel';
import { decisionStatusLabel } from '../decisions/decisionStatus';

/**
 * The Work overview's three lists (Simon, 2026-11-19): the open items, not
 * just a link to each page. Projects first. A decision is listed only if it
 * is not in a project, and a change only if it is in neither a decision nor
 * a project, so nothing appears twice — the same rule as Home's "My work".
 */
export interface WorkListItem {
  id: UUID;
  title: string;
  /** Plain-words status, e.g. "active", "proposed", "in review". */
  status: string;
}

export interface WorkLists {
  projects: WorkListItem[];
  decisions: WorkListItem[];
  changes: WorkListItem[];
}

const OPEN_BRANCH: ReadonlySet<BranchRow['status']> = new Set(['draft', 'proposed', 'in_review', 'approved']);

export function buildWorkLists(branches: readonly BranchRow[], decisions: readonly DecisionRow[], projects: readonly ProjectRow[], options: readonly DecisionOptionRow[]): WorkLists {
  const byTitle = (a: WorkListItem, b: WorkListItem) => a.title.localeCompare(b.title);
  const decisionById = new Map(decisions.map((d) => [d.id, d]));
  const decisionOfBranch = new Map<UUID, UUID>();
  for (const option of options) {
    if (option.branch_id !== null && !decisionOfBranch.has(option.branch_id)) decisionOfBranch.set(option.branch_id, option.decision_id);
  }

  const optionIds = new Set(options.flatMap((option) => (option.branch_id === null ? [] : [option.branch_id])));
  const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;
  const projectItems = projects
    .filter((p) => projectIsOpen(p.status))
    .map((p) => {
      const nDecisions = decisions.filter((d) => d.project_id === p.id && d.status === 'proposed').length;
      const nChanges = branches.filter((b) => b.kind === 'change' && OPEN_BRANCH.has(b.status) && (b.project_id === p.id || decisionById.get(decisionOfBranch.get(b.id) ?? '')?.project_id === p.id) && (b.project_id === p.id ? !optionIds.has(b.id) : true)).length;
      return { id: p.id, title: p.title, status: `${projectStatusLabel(p.status)} · ${plural(nDecisions, 'open decision')} · ${plural(nChanges, 'open change')}` };
    });
  const decisionItems = decisions.filter((d) => d.status === 'proposed' && d.project_id === null).map((d) => ({ id: d.id, title: d.title, status: decisionStatusLabel(d.status) }));
  const changeItems = branches
    .filter((b) => b.kind === 'change' && OPEN_BRANCH.has(b.status) && b.project_id === null && !decisionById.get(decisionOfBranch.get(b.id) ?? ''))
    .map((b) => ({ id: b.id, title: b.title ?? b.name, status: b.status.replace('_', ' ') }));
  return { projects: projectItems.sort(byTitle), decisions: decisionItems.sort(byTitle), changes: changeItems.sort(byTitle) };
}
