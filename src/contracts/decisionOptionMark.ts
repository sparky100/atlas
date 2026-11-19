/**
 * Per-option provenance (`decision_option_marks`,
 * `supabase/migrations/20261120010000_decision_option_marks.sql`; journey
 * proposal 5a). One mark per option an agent suggested: what it said, when, and
 * who edited it. A hand-added option has none. No logic, no I/O.
 */
export const DECISION_OPTION_AGENTS = ['designer'] as const;
export type DecisionOptionAgent = (typeof DECISION_OPTION_AGENTS)[number];

export interface DecisionOptionMark {
  decisionId: string;
  /** The option's branch id: the stable identity every later step (challenges, evidence claims) attaches to. */
  branchId: string;
  agent: DecisionOptionAgent;
  draftedAt: string;
  /** Reserved for the run record a later step adds. */
  draftRunId: string | null;
  /** What the agent actually said, so "edited" can be shown by comparison. */
  suggestedTitle: string;
  suggestedSummary: string;
  /** The last person to change the option after the agent wrote it, or null. */
  editedBy: string | null;
  editedAt: string | null;
}

/** True when the option as saved differs from what the agent said. */
export function optionWasEdited(mark: Pick<DecisionOptionMark, 'suggestedTitle' | 'suggestedSummary'>, title: string, summary: string): boolean {
  return mark.suggestedTitle.trim() !== title.trim() || mark.suggestedSummary.trim() !== summary.trim();
}
