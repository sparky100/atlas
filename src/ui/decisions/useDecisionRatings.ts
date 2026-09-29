import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { DECISION_RATING_NOTE_MAX_LENGTH, isValidDecisionRatingNote } from '../../contracts/decisionCriteria';
import { upsertDecisionRating } from '../../db/decisionRatings';
import type { DecisionRatingCriterion, DecisionRatingLevelValue } from '../../db/types';
import { supabase } from '../supabaseClient';

export type DecisionRatingsStatus = 'idle' | 'saving';

export interface RateOptionInput {
  decisionId: UUID;
  branchId: UUID;
  criterion: DecisionRatingCriterion;
  level: DecisionRatingLevelValue;
  /** Blank/whitespace-only is stored as `null` — "not rated"'s own note-indicator dot never lights up for a note that's only ever been empty. */
  note: string | null;
  userId: UUID;
}

export interface UseDecisionRatingsResult {
  status: DecisionRatingsStatus;
  error: string | null;
  /**
   * The Criteria grid's "tap to set/change a rating" — one upsert per
   * (decision, option, criterion) cell, mirrors `useDecisionOptions.ts`'s
   * own status/error/`onDone` shape so both hooks feel like the same
   * family from the component side. The note-length check happens here,
   * before the network call, so a caller gets the same validation message
   * `decisionCriteria.test.ts` already covers for `isValidDecisionRatingNote`
   * itself, rather than only ever seeing the database's own `check`-constraint
   * error text.
   */
  rateOption: (input: RateOptionInput) => Promise<boolean>;
}

export function useDecisionRatings(onDone: () => void): UseDecisionRatingsResult {
  const [status, setStatus] = useState<DecisionRatingsStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const rateOption = useCallback(
    async (input: RateOptionInput): Promise<boolean> => {
      const note = input.note !== null && input.note.trim().length > 0 ? input.note.trim() : null;
      if (!isValidDecisionRatingNote(note)) {
        setError(`Note must be ${String(DECISION_RATING_NOTE_MAX_LENGTH)} characters or fewer.`);
        return false;
      }
      setError(null);
      setStatus('saving');
      try {
        await upsertDecisionRating(supabase, { decisionId: input.decisionId, branchId: input.branchId, criterion: input.criterion, level: input.level, note, ratedBy: input.userId });
        onDone();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save this rating.');
        return false;
      } finally {
        setStatus('idle');
      }
    },
    [onDone],
  );

  return { status, error, rateOption };
}
