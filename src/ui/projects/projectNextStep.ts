/**
 * "What to do next" on a project page (Simon, 2026-11-19: a feature a person
 * cannot find does not exist for them). One next step, derived from what the
 * project already holds, with the single action that does it. Pure and
 * stored nowhere (CLAUDE.md rules 2 and 3). It never gates anything: the
 * forms below stay as they are.
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
  /** Owners and architects choose; others compare and hand over. Defaults to true. */
  canChoose?: boolean;
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
      : { kind: 'decide', title: 'Work out the options', body: 'An owner, architect or contributor starts the decision for this project.', action: { kind: 'none' } };
  }
  const firstProposed = proposed[0];
  if (chosen.length === 0 && firstProposed) {
    const open = proposed.length === 1 ? 'One decision is' : `${String(proposed.length)} decisions are`;
    const canChoose = input.canChoose ?? true;
    return { kind: 'compare', title: canChoose ? 'Compare your options and choose' : 'Compare your options', body: canChoose ? `No option is chosen yet. ${open} open. Add options, compare what each changes, then choose and give your reasons.` : `No option is chosen yet. ${open} open. Add options and compare what each changes. An owner or architect makes the choice.`, action: { kind: 'open-decision', id: firstProposed.id, label: `Open ${firstProposed.title}` } };
  }
  if (chosen.length === 0) {
    // Decisions exist but every one was rejected, superseded or cancelled: nothing was chosen, so there is no choice to carry out.
    return input.canStartDecision
      ? { kind: 'decide', title: 'Start a new decision', body: 'The earlier decision ended without an option being carried forward. Start a new one to work out the options again.', action: { kind: 'start-decision' } }
      : { kind: 'decide', title: 'Start a new decision', body: 'The earlier decision ended without an option being carried forward. An owner, architect or contributor starts a new one.', action: { kind: 'none' } };
  }
  if (input.changes.length === 0) {
    if (input.canCreateChange && input.canDraftChange) {
      return { kind: 'change', title: 'Draft the change that carries out your choice', body: 'An option is chosen. A change is a draft of what would be different in the model. It stays a draft until it is reviewed.', action: { kind: 'start-change' } };
    }
    return { kind: 'change', title: 'Draft the change that carries out your choice', body: 'An option is chosen. A contributor, architect or owner drafts the change.', action: { kind: 'none' } };
  }
  const firstOpen = openChanges[0];
  if (firstOpen) {
    return { kind: 'deliver', title: 'Take the change through review', body: `${openChanges.length === 1 ? 'One change is' : `${String(openChanges.length)} changes are`} not yet merged or cancelled.`, action: { kind: 'open-change', id: firstOpen.id, label: `Open ${firstOpen.title ?? firstOpen.name}` } };
  }
  if (!input.changes.some((c) => c.status === 'merged')) {
    // Every change was cancelled: the choice has not been carried out.
    return input.canCreateChange && input.canDraftChange
      ? { kind: 'change', title: 'Draft another change', body: 'Every change was cancelled, so your choice has not been carried out. Draft another change, or close the project from Status above if you are stopping.', action: { kind: 'start-change' } }
      : { kind: 'change', title: 'Draft another change', body: 'Every change was cancelled, so your choice has not been carried out. A contributor, architect or owner drafts another, or the project is closed from Status above.', action: { kind: 'none' } };
  }
  return { kind: 'finish', title: 'Check the result, then close the project', body: 'The changes are merged into the model. That records what changed. It does not show the project achieved its purpose, so check that first, then close the project from Status above.', action: { kind: 'none' } };
}
