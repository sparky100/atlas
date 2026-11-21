/**
 * D2, PR 4: a question an AI reviewer drafted that a person chose to keep on
 * a decision. Kept questions are insert-only, are not an approval, are not a
 * "concern" (those are element links), and never write to the live model.
 */
import type { UUID } from './delta';

export type DecisionAgentNoteLens = 'challenge' | 'cyber' | 'data';
export type DecisionAgentNoteAgent = 'challenger' | 'steward';
export type DecisionAgentNoteBasedOn = 'option' | 'element' | 'none';

export interface DecisionAgentNote {
  id: UUID;
  decisionId: UUID;
  /** The option the note points at, when it does; `null` when it is not tied to a record. */
  branchId: UUID | null;
  lens: DecisionAgentNoteLens;
  agent: DecisionAgentNoteAgent;
  /** What the AI said, kept even when the person edits the question. */
  suggestedQuestion: string;
  /** The question as kept (possibly edited). */
  question: string;
  basedOn: DecisionAgentNoteBasedOn;
  basedOnLabel: string | null;
  /** SHA-256 of the exact digest the reviewer was sent. */
  inputHash: string;
  runId: UUID | null;
  keptBy: UUID;
  keptAt: string;
}

/** The agent a lens belongs to — the table's own check restated in code. */
export function agentForLens(lens: DecisionAgentNoteLens): DecisionAgentNoteAgent {
  return lens === 'challenge' ? 'challenger' : 'steward';
}

export interface KeepDecisionAgentNoteInput {
  decisionId: UUID;
  branchId: UUID | null;
  lens: DecisionAgentNoteLens;
  suggestedQuestion: string;
  question: string;
  basedOn: DecisionAgentNoteBasedOn;
  basedOnLabel: string | null;
  inputHash: string;
  runId: UUID | null;
  keptBy: UUID;
}
