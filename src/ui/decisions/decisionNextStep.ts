/** What the decision page tells this person to do next: one sentence and, at most, one action. Driven by the decision's state and the viewer's role (CLAUDE.md UX rules 4 and 7). */
export type DecisionNextAction = 'add-option' | 'compare' | 'choose' | 'ask-to-choose' | 'open-delivery' | 'none';

export interface DecisionNextStepInput {
  status: 'proposed' | 'accepted' | 'rejected' | 'superseded';
  /** Options other than the "stay as we are" baseline. */
  optionCount: number;
  /** How many of those options have at least one rating. */
  ratedOptionCount: number;
  canAddOption: boolean;
  canChoose: boolean;
  /** Title of the chosen option, once there is one. */
  chosenTitle: string | null;
  /** True when the chosen option is the "stay as we are" baseline, so there is no delivery change to open. */
  chosenIsBaseline?: boolean;
}

export interface DecisionNextStep {
  title: string;
  body: string;
  action: DecisionNextAction;
  actionLabel: string | null;
}

export function decisionNextStep(i: DecisionNextStepInput): DecisionNextStep | null {
  if (i.status === 'rejected' || i.status === 'superseded') return null;
  if (i.status === 'accepted') {
    if (i.chosenIsBaseline === true) {
      return { title: 'Chosen', body: 'Staying as we are was chosen. No model change is planned.', action: 'none', actionLabel: null };
    }
    if (i.chosenTitle === null) {
      return { title: 'Chosen', body: 'An option was chosen. Its delivery change is no longer linked to this decision.', action: 'none', actionLabel: null };
    }
    return {
      title: 'Chosen',
      body: `${i.chosenTitle} was chosen. Open it to draft and submit the delivery.`,
      action: 'open-delivery',
      actionLabel: 'Open the chosen option',
    };
  }
  if (i.optionCount === 0) {
    return i.canAddOption
      ? { title: 'Add the options', body: 'Add an option, or ask the Designer for suggestions. Staying as we are is always one of them.', action: 'add-option', actionLabel: null }
      : { title: 'Waiting for options', body: 'An owner, architect or contributor adds the options.', action: 'none', actionLabel: null };
  }
  const rated = `${String(i.ratedOptionCount)} of ${String(i.optionCount)} options rated.`;
  if (i.canChoose) {
    return { title: 'Choose an option', body: `${rated} Compare what each changes, then choose and give your reasons. Rating first is optional but makes the choice easier to explain.`, action: 'choose', actionLabel: 'Review what changes' };
  }
  if (i.ratedOptionCount === 0) {
    return { title: 'Compare the options', body: 'Rate each option for cost, effort, delivery risk, timing and vendor fit. It is optional, but it makes the choice easier to explain. An owner or architect makes the choice.', action: 'compare', actionLabel: 'Go to the comparison' };
  }
  return { title: 'Ready for a choice?', body: `${rated} When you are done, ask an owner or architect to choose.`, action: 'ask-to-choose', actionLabel: 'Ask an owner or architect to choose' };
}

/** The comment the handoff posts: mentions each approver so they are notified the normal way. */
export function askToChooseComment(handles: readonly string[], decisionTitle: string): string {
  const mentions = handles.map((h) => `@${h}`).join(' ');
  return `${mentions} The options for "${decisionTitle}" are ready. Please compare them and choose one.`.trim();
}
