/**
 * Pure, testable logic for the Projects list and project page (ADR-024
 * §5 "what is derived, never stored", §6 views). No I/O.
 */
import type { ElementType, UUID } from '../../contracts/delta';
import type { BranchRow, DecisionRow, ProjectRow, ProjectStatus } from '../../db/types';
import type { ChipTone } from '../components/Chip/Chip';

/**
 * A declared-scope pick on the Start-a-project form: an element id, the
 * name frozen at pick time, and the element's type so the form can tell a
 * capability from a system or container. `elementType` is optional only
 * because a pick restored from a prefill URL may arrive without it (an
 * older link, or a hand-edited one); a pick the person adds through the
 * picker always carries it.
 */
export interface ProjectScopeItem {
  elementId: UUID;
  name: string;
  elementType?: ElementType;
}

/**
 * Simon's rule (2026-11-18): "a project can't be independent of a
 * capability." Plan A1: the Start-a-project form requires at least one
 * capability in its declared scope — a system or container alone is not
 * enough, because the project has to say which capability it serves. This
 * is the UI guard only; the database guarantee is a later, optional step.
 * A pick whose type is unknown is treated as "not a capability", so the
 * person is asked to name one rather than the form guessing.
 */
export function scopeHasCapability(scope: readonly ProjectScopeItem[]): boolean {
  return scope.some((s) => s.elementType === 'capability');
}

/** Display order of the Projects list's groups: live work first, finished last. */
export const PROJECT_STATUS_ORDER: readonly ProjectStatus[] = ['active', 'on_hold', 'closed', 'cancelled'];

export function projectStatusLabel(status: ProjectStatus): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'on_hold':
      return 'On hold';
    case 'closed':
      return 'Closed';
    case 'cancelled':
      return 'Cancelled';
  }
}

/** Never colour alone — `Chip` always shows the label beside the tone. */
export function projectStatusTone(status: ProjectStatus): ChipTone {
  switch (status) {
    case 'active':
      return 'info';
    case 'on_hold':
      return 'warn';
    case 'closed':
      return 'ok';
    case 'cancelled':
      return 'neutral';
  }
}

export function groupProjectsByStatus(projects: readonly ProjectRow[]): { status: ProjectStatus; projects: ProjectRow[] }[] {
  return PROJECT_STATUS_ORDER.map((status) => ({ status, projects: projects.filter((p) => p.status === status) })).filter((g) => g.projects.length > 0);
}

/**
 * ADR-024 §6: a project's changes by stage — options being explored →
 * chosen design → in review → merged. `closed` holds the changes that
 * ended without merging (cancelled, rejected, archived).
 */
export type ProjectChangeStage = 'exploring' | 'chosen' | 'in_review' | 'merged' | 'closed';

export const PROJECT_CHANGE_STAGES: readonly ProjectChangeStage[] = ['exploring', 'chosen', 'in_review', 'merged', 'closed'];

export function projectChangeStageLabel(stage: ProjectChangeStage): string {
  switch (stage) {
    case 'exploring':
      return 'Options being explored';
    case 'chosen':
      return 'Chosen design';
    case 'in_review':
      return 'In review';
    case 'merged':
      return 'Merged';
    case 'closed':
      return 'Closed without merging';
  }
}

export function projectChangeStage(branch: Pick<BranchRow, 'status' | 'intent'>): ProjectChangeStage {
  switch (branch.status) {
    case 'merged':
      return 'merged';
    case 'cancelled':
    case 'rejected':
    case 'archived':
      return 'closed';
    case 'proposed':
    case 'in_review':
    case 'approved':
      return 'in_review';
    case 'draft':
      // An explore-intent draft is an option still being weighed; any other
      // draft is a design the project has committed to (a chosen option
      // turns propose on Choose, or a change made directly in the project).
      return branch.intent === 'explore' ? 'exploring' : 'chosen';
  }
}

export function groupChangesByStage(changes: readonly BranchRow[]): { stage: ProjectChangeStage; changes: BranchRow[] }[] {
  return PROJECT_CHANGE_STAGES.map((stage) => ({ stage, changes: changes.filter((c) => projectChangeStage(c) === stage) })).filter((g) => g.changes.length > 0);
}

/**
 * ADR-024 §5: the declared scope against what the project's changes
 * actually touch — a prompt, shown, never auto-corrected. A scope item a
 * change only *affects* (`reached`: a capability or value stream reached
 * through change impact, §8) is covered — it isn't "not touched" — but
 * isn't counted as touched-out-of-scope either: impact reaches widely, and
 * that list is for what the changes edit.
 */
export function scopeDifference(declared: readonly UUID[], touched: readonly UUID[], reached: readonly UUID[] = []): { touchedNotDeclared: UUID[]; declaredNotTouched: UUID[] } {
  const declaredSet = new Set(declared);
  const touchedSet = new Set(touched);
  const coveredSet = new Set([...touched, ...reached]);
  return {
    touchedNotDeclared: [...touchedSet].filter((id) => !declaredSet.has(id)),
    declaredNotTouched: [...declaredSet].filter((id) => !coveredSet.has(id)),
  };
}

/** ADR-024 §5 "overdue decisions": proposed, with a needed-by date before `today` (ISO `YYYY-MM-DD`). */
export function isDecisionOverdue(decision: Pick<DecisionRow, 'status' | 'needed_by'>, today: string): boolean {
  return decision.status === 'proposed' && decision.needed_by !== null && decision.needed_by < today;
}

/** ADR-024 §5 "progress": counts, never a percentage (Atlas does not score). */
export interface ProjectProgress {
  openChanges: number;
  mergedChanges: number;
  openDecisions: number;
  decidedDecisions: number;
}

export function projectProgress(changes: readonly Pick<BranchRow, 'status' | 'intent'>[], decisions: readonly Pick<DecisionRow, 'status'>[]): ProjectProgress {
  const stages = changes.map((c) => projectChangeStage(c));
  return {
    openChanges: stages.filter((s) => s === 'exploring' || s === 'chosen' || s === 'in_review').length,
    mergedChanges: stages.filter((s) => s === 'merged').length,
    openDecisions: decisions.filter((d) => d.status === 'proposed').length,
    decidedDecisions: decisions.filter((d) => d.status !== 'proposed').length,
  };
}

/** A project's progress as one line of plain counts, never a percentage — the project page and Overview's "What we're doing" both read it this way. */
export function formatProjectProgress(progress: ProjectProgress): string {
  const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;
  return `${plural(progress.openChanges, 'open change', 'open changes')} · ${String(progress.mergedChanges)} merged · ${plural(progress.openDecisions, 'open decision', 'open decisions')} · ${String(progress.decidedDecisions)} decided`;
}

/** The originating decision (ADR-024 §5): the project's earliest decision, if any — no column, just the first entry in the log. */
export function originatingDecision(decisions: readonly DecisionRow[]): DecisionRow | null {
  let earliest: DecisionRow | null = null;
  for (const d of decisions) if (earliest === null || d.created_at < earliest.created_at) earliest = d;
  return earliest;
}

/**
 * P4 as the UI explains it: what still blocks closing. The RPC is the
 * real gate; this only lists the items so the person can deal with each.
 */
export function openItemsBlockingClose(changes: readonly BranchRow[], decisions: readonly DecisionRow[]): { changes: BranchRow[]; decisions: DecisionRow[] } {
  return {
    changes: changes.filter((c) => c.status === 'draft' || c.status === 'proposed' || c.status === 'in_review' || c.status === 'approved'),
    decisions: decisions.filter((d) => d.status === 'proposed'),
  };
}
