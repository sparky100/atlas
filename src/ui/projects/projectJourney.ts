/**
 * Plan B1: a project's journey strip — the four steps from need to choice,
 * shown as a plain progress read-out and derived from what the project
 * already holds (nothing stored, CLAUDE.md rules 2 and 3):
 *
 * 1. Requirement — the project's purpose, in plain words.
 * 2. What it touches — the capabilities in its declared scope, and any change
 *    drafted to carry it out.
 * 3. How it might be met — an estate query: for each capability, the systems
 *    we already run that support it. Nothing supporting it is itself the
 *    answer ("a buy or build option is needed"), not an error.
 * 4. Choosing — the decisions about it, and how many are chosen.
 *
 * Each step reads Done, Next (the first not done) or Not started, in words,
 * never by colour alone. The strip reports; it does not gate anything.
 */
export type JourneyStepKey = 'requirement' | 'touches' | 'met' | 'choose';
export type JourneyStepState = 'done' | 'next' | 'todo';

export interface JourneyStep {
  key: JourneyStepKey;
  title: string;
  state: JourneyStepState;
  /** One plain line saying where this step stands. */
  detail: string;
}

export interface JourneyCapability {
  id: string;
  name: string;
  /** Names of systems we run today that support this capability. */
  supporters: readonly string[];
}

export interface JourneyInput {
  purpose: string;
  capabilities: readonly JourneyCapability[];
  /** Changes drafted for the project (any stage). */
  changeCount: number;
  decisionCount: number;
  /** Decisions already chosen (accepted). */
  chosenCount: number;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

function purposeExcerpt(purpose: string): string {
  const text = purpose.trim().replace(/\s+/g, ' ');
  return text.length > 90 ? `${text.slice(0, 89).trimEnd()}…` : text;
}

export function buildProjectJourney(input: JourneyInput): JourneyStep[] {
  const { purpose, capabilities, changeCount, decisionCount, chosenCount } = input;
  const hasPurpose = purpose.trim() !== '';
  const hasCapability = capabilities.length > 0;
  const supported = capabilities.filter((c) => c.supporters.length > 0);
  const unsupported = capabilities.filter((c) => c.supporters.length === 0);

  const requirement: JourneyStep = {
    key: 'requirement',
    title: 'Requirement',
    state: hasPurpose ? 'done' : 'todo',
    detail: hasPurpose ? purposeExcerpt(purpose) : 'No purpose written yet. Say the problem or opportunity in plain words.',
  };
  const touches: JourneyStep = {
    key: 'touches',
    title: 'What it touches',
    state: hasCapability ? 'done' : 'todo',
    detail: hasCapability
      ? `${String(capabilities.length)} ${plural(capabilities.length, 'capability', 'capabilities')} in scope${changeCount > 0 ? `, ${String(changeCount)} ${plural(changeCount, 'change', 'changes')} drafted` : ', no change drafted yet'}.`
      : 'No capability named yet.',
  };
  let metDetail: string;
  if (!hasCapability) metDetail = 'Needs a capability first.';
  else if (unsupported.length === 0) metDetail = `Every capability is already supported by something we run (${String(supported.length)}).`;
  else if (supported.length === 0) metDetail = `Nothing we run supports ${unsupported.map((c) => c.name).join(', ')} — a buy or build option is needed.`;
  else metDetail = `${String(supported.length)} already supported by something we run; nothing supports ${unsupported.map((c) => c.name).join(', ')}.`;
  const met: JourneyStep = { key: 'met', title: 'How it might be met', state: hasCapability ? 'done' : 'todo', detail: metDetail };
  const choose: JourneyStep = {
    key: 'choose',
    title: 'Choosing',
    state: chosenCount > 0 ? 'done' : 'todo',
    detail:
      decisionCount === 0
        ? 'No decision started yet.'
        : chosenCount > 0
          ? `${String(chosenCount)} of ${String(decisionCount)} ${plural(decisionCount, 'decision', 'decisions')} chosen.`
          : `${String(decisionCount)} ${plural(decisionCount, 'decision', 'decisions')} open, none chosen yet.`,
  };

  const steps = [requirement, touches, met, choose];
  const firstTodo = steps.findIndex((s) => s.state === 'todo');
  if (firstTodo >= 0) steps[firstTodo] = { ...steps[firstTodo], state: 'next' } as JourneyStep;
  return steps;
}
