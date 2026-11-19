/**
 * "What to do next" on a project page (Simon, 2026-11-19: a feature a person
 * cannot find does not exist for them). One next step, derived from what the
 * project already holds, with the single action that does it. Pure and
 * stored nowhere (CLAUDE.md rules 2 and 3). It never gates anything: the
 * journey strip and every form below stay as they are.
 *
 * The action says who can do it. When the person's role cannot, the card
 * still names the step and says who needs to do it, so the page never goes
 * quiet.
 */
export type NextStepKind = 'purpose' | 'capability' | 'decide' | 'compare' | 'change' | 'deliver' | 'finish';

export type NextStepAction =
  /** The form for this step sits in the card itself. */
  | { kind: 'start-decision' }
  | { kind: 'start-change' }
  /** Go to a decision or change that already exists. */
  | { kind: 'open-decision'; id: string; label: string }
  | { kind: 'open-change'; id: string; label: string }
  /** Nothing to press: the step happens in a section named in the body. */
  | { kind: 'none' };

export interface NextStep {
  kind: NextStepKind;
  title: string;
  body: string;
  action: NextStepAction;
}

export interface NextStepInput {
  isOpen: boolean;
  purpose: string;
  hasCapability: boolean;
  decisions: readonly { id: string; title: string; status: string }[];
  changes: readonly { id: string; title: string | null; name: string; status: string }[];
  canStartDecision: boolean;
  canCreateChange: boolean;
  /** The live model has a head to branch from; a change can't be drafted without one. */
  canDraftChange: boolean;
}

const CHANGE_DONE = new Set(['merged', 'cancelled']);

export function projectNextStep(input: NextStepInput): NextStep | null {
  if (!input.isOpen) return null;
  if (input.purpose.trim() === '') {
    return { kind: 'purpose', title: 'Say what this project is for', body: 'Write the problem or opportunity in plain words. Use Edit project above.', action: { kind: 'none' } };
  }
  if (!input.hasCapability) {
    return { kind: 'capability', title: 'Name the capability this project serves', body: "A project can't stand apart from a capability. Add one under Declared scope below.", action: { kind: 'none' } };
  }
  const proposed = input.decisions.filter((d) => d.status === 'proposed');
  const chosen = input.decisions.filter((d) => d.status === 'accepted');
  const openChanges = input.changes.filter((c) => !CHANGE_DONE.has(c.status));

  if (input.decisions.length === 0) {
    return input.canStartDecision
      ? { kind: 'decide', title: 'Work out the options', body: "Start a decision. It takes this project's purpose as its context and the project's scope as what it concerns, and opens ready to edit.", action: { kind: 'start-decision' } }
      : { kind: 'decide', title: 'Work out the options', body: 'An owner or architect starts the decision for this project.', action: { kind: 'none' } };
  }
  const firstProposed = proposed[0];
  if (chosen.length === 0 && firstProposed) {
    return { kind: 'compare', title: 'Compare your options and choose', body: `${proposed.length === 1 ? 'One decision is' : `${String(proposed.length)} decisions are`} open. Add options, compare what each changes, then choose and give your reasons.`, action: { kind: 'open-decision', id: firstProposed.id, label: `Open ${firstProposed.title}` } };
  }
  if (input.changes.length === 0) {
    if (input.canCreateChange && input.canDraftChange) {
      return { kind: 'change', title: 'Draft the change that carries out your choice', body: 'A change is a draft of what would be different in the model. It stays a draft until it is reviewed.', action: { kind: 'start-change' } };
    }
    return { kind: 'change', title: 'Draft the change that carries out your choice', body: 'A contributor, architect or owner drafts the change.', action: { kind: 'none' } };
  }
  const firstOpen = openChanges[0];
  if (firstOpen) {
    return { kind: 'deliver', title: 'Take the change through review', body: `${openChanges.length === 1 ? 'One change is' : `${String(openChanges.length)} changes are`} not yet merged or cancelled.`, action: { kind: 'open-change', id: firstOpen.id, label: `Open ${firstOpen.title ?? firstOpen.name}` } };
  }
  return { kind: 'finish', title: 'Close the project', body: 'The decision is made and the changes are done. Close the project from Status above when you are ready.', action: { kind: 'none' } };
}
