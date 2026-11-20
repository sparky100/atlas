import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { clearDecisionFormDraft, decisionFormDraftKey, draftDiffers, loadDecisionFormDraft, saveDecisionFormDraft, type DecisionFormDraft } from './decisionFormDraft';
import { clockNow } from './pendingOptions';

export interface DecisionFormDraftState {
  /** A draft from earlier worth offering back, until the person types, restores or discards. */
  offered: DecisionFormDraft | null;
  /** Keep what is typed now. Call from the change handlers, so untouched prefilled text is never stored as a draft. */
  remember: (draft: DecisionFormDraft) => void;
  /** The decision was started: nothing is left to recover. */
  clear: () => void;
  /** The person took the draft back. */
  accept: () => void;
  /** The person let the draft go. */
  discard: () => void;
}

/**
 * Draft recovery for a "start a decision" form (journey proposal, step 3).
 * Held in this browser for 24 hours, per organisation and person, and never
 * sent anywhere until the decision is started.
 */
export function useDecisionFormDraft(orgId: UUID, userId: UUID | null, scope: string, current: DecisionFormDraft): DecisionFormDraftState {
  const key = userId !== null ? decisionFormDraftKey(orgId, userId, scope) : null;
  const [held, setHeld] = useState<DecisionFormDraft | null>(() => (key !== null ? loadDecisionFormDraft(localStorage, key, clockNow()) : null));
  const [settled, setSettled] = useState(false);
  const offered = !settled && draftDiffers(held, current) ? held : null;

  const remember = useCallback(
    (draft: DecisionFormDraft) => {
      setSettled(true);
      if (key !== null) saveDecisionFormDraft(localStorage, key, draft, clockNow());
    },
    [key],
  );
  const clear = useCallback(() => {
    setSettled(true);
    setHeld(null);
    if (key !== null) clearDecisionFormDraft(localStorage, key);
  }, [key]);
  const accept = useCallback(() => {
    setSettled(true);
  }, []);
  return { offered, remember, clear, accept, discard: clear };
}
