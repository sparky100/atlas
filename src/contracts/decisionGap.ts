/**
 * Phase 2a: a short note a person records when a research search or catalogue
 * lookup did not find what the decision needed. It belongs to the option it was
 * recorded from, or to the decision as a whole. It is a note for the next
 * reader, never evidence, a catalogue claim or a change to the model.
 */
export const DECISION_GAP_BODY_MAX = 500;

export type DecisionGapOrigin = 'research' | 'catalogue' | 'manual';

export interface DecisionGap {
  id: string;
  decisionId: string;
  /** The option the gap was recorded from; null when it is about the decision as a whole. */
  branchId: string | null;
  /** Filled from the branch when the database knows the candidate identity. */
  optionId: string | null;
  origin: DecisionGapOrigin;
  body: string;
  createdBy: string;
  createdAt: string;
}

export interface RecordDecisionGapInput {
  decisionId: string;
  branchId: string | null;
  /** The candidate option the gap is about; when given, a branchless candidate can hold a gap. */
  optionId?: string | null;
  userId: string;
  body: string;
  origin: DecisionGapOrigin;
}

export function decisionGapProblem(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) return 'Write what you could not find.';
  if (trimmed.length > DECISION_GAP_BODY_MAX) return `Keep the gap to ${String(DECISION_GAP_BODY_MAX)} characters or fewer.`;
  return null;
}
