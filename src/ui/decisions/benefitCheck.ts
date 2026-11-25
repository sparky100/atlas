import type { DecisionBenefitCheckRow, DecisionBenefitResult } from '../../db/types';

/** The three answers, in the order the form offers them. */
export const BENEFIT_RESULTS: readonly { value: DecisionBenefitResult; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'partly', label: 'Partly' },
  { value: 'not_yet', label: 'Not yet' },
];

export function benefitResultLabel(result: DecisionBenefitResult): string {
  return BENEFIT_RESULTS.find((r) => r.value === result)?.label ?? result;
}

export function benefitTone(result: DecisionBenefitResult): 'ok' | 'warn' | 'neutral' {
  return result === 'yes' ? 'ok' : result === 'partly' ? 'warn' : 'neutral';
}

/**
 * One check in plain words, with who and when (UX rule 7: never imply more
 * than happened). "Not yet" is a check, not a confirmation, so it says
 * "Checked with" rather than "confirmed by".
 */
export function benefitLine(check: Pick<DecisionBenefitCheckRow, 'result' | 'note' | 'recorded_at'>, confirmerName: string): string {
  const when = check.recorded_at.slice(0, 10);
  const head = check.result === 'not_yet' ? `Checked with ${confirmerName} on ${when}: not yet.` : `Benefit confirmed by ${confirmerName} on ${when}: ${benefitResultLabel(check.result)}.`;
  const note = check.note.trim();
  return note === '' ? head : `${head} ${note}`;
}

/** Whether the "Did we get the outcome?" step applies yet, and what to say when it doesn't. */
export function benefitStepState(args: { chosenIsBaseline: boolean; inLiveModel: boolean }): 'not_applicable' | 'waiting_for_live' | 'open' {
  if (args.chosenIsBaseline) return 'not_applicable';
  return args.inLiveModel ? 'open' : 'waiting_for_live';
}
