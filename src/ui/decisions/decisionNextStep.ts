/** What the decision page tells this person to do next: one sentence and, at most, one action. Driven by the decision's state and the viewer's role (CLAUDE.md UX rules 4 and 7). */
export type DecisionNextAction = 'add-outcome' | 'add-option' | 'compare' | 'choose' | 'ask-to-choose' | 'start-delivery' | 'open-delivery' | 'start-product-decision' | 'open-product-decision' | 'none';

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
  /** True once the chosen option has a delivery change. Choosing makes none; "Start delivery" does. */
  deliveryStarted?: boolean;
  /** Owners, architects and contributors may start delivery on the chosen option. */
  canStartDelivery?: boolean;
  /** False while the decision has no outcome written (item 3). Absent is treated as written, for callers that do not show it. */
  hasOutcome?: boolean;
  /** Whether this person can edit the decision, and so write its outcome. */
  canEditOutcome?: boolean;
  /** True when the chosen option is Buy: the product is decided next, in its own decision (Simon, 2026-11-26). */
  chosenIsBuy?: boolean;
  /** The product decision for the chosen Buy option, once started; `null` when none is open or decided. */
  productDecision?: { title: string; status: 'proposed' | 'accepted'; chosenTitle: string | null } | null;
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
    if (i.chosenIsBuy === true && i.deliveryStarted !== true) {
      const pd = i.productDecision ?? null;
      if (pd === null) {
        return i.canStartDelivery === true
          ? { title: 'Choose the product', body: `${i.chosenTitle} was chosen. Next, decide which product. A new decision starts with the need, the outcome and the listed products already filled in. If the product is already settled, start delivery on the option instead.`, action: 'start-product-decision', actionLabel: 'Start the product decision' }
          : { title: 'Choose the product', body: `${i.chosenTitle} was chosen. Next, an owner, architect or contributor starts a decision on which product.`, action: 'none', actionLabel: null };
      }
      if (pd.status === 'proposed') {
        return { title: 'Choosing the product', body: `${i.chosenTitle} was chosen. Which product is being decided in "${pd.title}".`, action: 'open-product-decision', actionLabel: 'Open the product decision' };
      }
      return { title: 'Product chosen', body: `${pd.chosenTitle ?? 'A product'} was chosen in "${pd.title}". Delivery starts from that decision.`, action: 'open-product-decision', actionLabel: 'Open the product decision' };
    }
    if (i.deliveryStarted !== true) {
      return i.canStartDelivery === true
        ? { title: 'Chosen', body: `${i.chosenTitle} was chosen. Nothing in the model has changed yet. Start delivery to draft the change.`, action: 'start-delivery', actionLabel: 'Start delivery' }
        : { title: 'Chosen', body: `${i.chosenTitle} was chosen. Nothing in the model has changed yet. An owner, architect or contributor starts delivery.`, action: 'none', actionLabel: null };
    }
    return {
      title: 'Chosen',
      body: `${i.chosenTitle} was chosen and delivery has started. Open the change to draft and submit it.`,
      action: 'open-delivery',
      actionLabel: 'Open the delivery change',
    };
  }
  if (i.hasOutcome === false) {
    return i.canEditOutcome === true
      ? { title: 'Say what outcome you want', body: 'Say what will be better, for whom, by when, so the options can be judged against it. For example: issue a connection quote in two days, not ten, by March 2027.', action: 'add-outcome', actionLabel: 'Add the outcome' }
      : { title: 'Waiting for the outcome', body: 'The person who started this decision, or an owner or architect, says what will be better, for whom, by when. You can still read and comment on the options.', action: 'none', actionLabel: null };
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
    return { title: 'Compare the options', body: 'Rate each option on whether it reaches the outcome, and for cost, effort, delivery risk, timing and vendor fit. It is optional, but it makes the choice easier to explain. An owner or architect makes the choice.', action: 'compare', actionLabel: 'Go to the comparison' };
  }
  return { title: 'Ready for a choice?', body: `${rated} When you are done, ask an owner or architect to choose.`, action: 'ask-to-choose', actionLabel: 'Ask an owner or architect to choose' };
}

/** The comment the handoff posts: mentions each approver so they are notified the normal way. */
export function askToChooseComment(handles: readonly string[], decisionTitle: string): string {
  const mentions = handles.map((h) => `@${h}`).join(' ');
  return `${mentions} The options for "${decisionTitle}" are ready. Please compare them and choose one.`.trim();
}
