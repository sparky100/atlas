import { useCallback, useEffect, useRef, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { DECISION_RATING_NOTE_MAX_LENGTH, isValidDecisionRatingNote } from '../../contracts/decisionCriteria';
import { listDecisionRatingsForDecision, upsertDecisionRating } from '../../db/decisionRatings';
import type { DecisionOptionRatingRow, DecisionRatingCriterion, DecisionRatingLevelValue } from '../../db/types';
import { supabase } from '../supabaseClient';

export type DecisionRatingsStatus = 'loading' | 'idle' | 'saving';

export interface RateOptionInput {
  decisionId: UUID;
  /** Null for a candidate with no delivery branch. */
  branchId: UUID | null;
  /** The candidate identity the cell belongs to. */
  optionId: UUID;
  criterion: DecisionRatingCriterion;
  level: DecisionRatingLevelValue;
  /** Blank/whitespace-only is stored as `null` — "not rated"'s own note-indicator dot never lights up for a note that's only ever been empty. */
  note: string | null;
  userId: UUID;
}

export interface UseDecisionRatingsResult {
  ratings: DecisionOptionRatingRow[];
  status: DecisionRatingsStatus;
  error: string | null;
  /**
   * The Criteria grid's "tap to set/change a rating" — one upsert per
   * (decision, option, criterion) cell. The cell updates optimistically
   * (before the network round trip resolves) and rolls back to the real
   * server state on failure — this hook owns the ratings data itself
   * (see the module comment), so a save patches only its own local
   * `ratings` state, never the decision page's own `reload()`.
   */
  rateOption: (input: RateOptionInput) => Promise<boolean>;
}

/** `(option_id, criterion)` - the same pair `decision_option_ratings`'s own primary key (minus `decision_id`, constant per hook instance) and `upsertDecisionRating`'s own `onConflict` target use. A legacy row with no option id falls back to its branch id. */
export function ratingKey(ownerId: string | null, criterion: string): string {
  return `${ownerId ?? ''}:${criterion}`;
}

function ratingOwnerId(row: DecisionOptionRatingRow): string | null {
  return row.option_id ?? row.branch_id;
}

/** Replaces the row matching `row`'s own key, or appends it - the one place a cell's value ever changes in local state, whether from an optimistic write, a save's real response, or a background refetch. */
export function upsertRatingByKey(rows: readonly DecisionOptionRatingRow[], row: DecisionOptionRatingRow): DecisionOptionRatingRow[] {
  const key = ratingKey(ratingOwnerId(row), row.criterion);
  const index = rows.findIndex((r) => ratingKey(ratingOwnerId(r), r.criterion) === key);
  if (index === -1) return [...rows, row];
  const next = [...rows];
  next[index] = row;
  return next;
}

/**
 * The quiet multi-user refetch's own merge rule: `fresh` (a real re-read
 * of the table) wins for every cell *except* one whose key is currently
 * `pendingKeys` — a save this tab itself has in flight. Without this
 * guard, a background poll landing mid-save could overwrite the
 * optimistic value with `fresh`'s own stale pre-save row, then the save's
 * own real response would overwrite it right back — visually flickering,
 * and briefly showing a wrong value in between. A `prev` row whose key is
 * pending but missing from `fresh` (the write hasn't reached this poll's
 * own read yet) is kept too, not dropped.
 */
export function mergeQuietRefetch(prev: readonly DecisionOptionRatingRow[], fresh: readonly DecisionOptionRatingRow[], pendingKeys: ReadonlySet<string>): DecisionOptionRatingRow[] {
  const prevByKey = new Map(prev.map((r) => [ratingKey(ratingOwnerId(r), r.criterion), r]));
  const result: DecisionOptionRatingRow[] = [];
  const seenKeys = new Set<string>();
  for (const row of fresh) {
    const key = ratingKey(ratingOwnerId(row), row.criterion);
    seenKeys.add(key);
    const pendingRow = pendingKeys.has(key) ? prevByKey.get(key) : undefined;
    result.push(pendingRow ?? row);
  }
  for (const [key, row] of prevByKey) {
    if (pendingKeys.has(key) && !seenKeys.has(key)) result.push(row);
  }
  return result;
}

/** How often the quiet background refetch polls while the tab is visible — frequent enough that another architect's rating shows up without a manual reload, not so frequent it's a real load on the decision. */
const QUIET_REFETCH_INTERVAL_MS = 45_000;

/**
 * Owns a decision's own `decision_option_ratings` — fetch, optimistic
 * write, and a quiet background refetch for multi-user visibility — as
 * its own data lifecycle, fully independent of `useDecision.ts`'s page
 * bundle and `useDecisionComparison.ts`'s structural fold. A rating save
 * here never calls the decision page's own `reload()`: it patches this
 * hook's own `ratings` state directly from `upsertDecisionRating`'s own
 * response, so nothing else on the page re-fetches, re-folds, or
 * unmounts. (The page's own full-reload-on-`reload()` behaviour for
 * Choose/Arguments/Comments is unchanged this sprint — see this sprint's
 * own follow-up note.)
 */
export function useDecisionRatings(modelId: UUID, decisionId: UUID): UseDecisionRatingsResult {
  const [ratings, setRatings] = useState<DecisionOptionRatingRow[]>([]);
  const [status, setStatus] = useState<DecisionRatingsStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  // A ref, not state: read synchronously inside the interval/visibility
  // callbacks below without those closures going stale, and never itself
  // triggers a re-render (only `ratings`/`status`/`error` should).
  const pendingKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    if (!modelId || !decisionId) return undefined;
    listDecisionRatingsForDecision(supabase, decisionId)
      .then((rows) => {
        if (!cancelled) {
          setRatings(rows);
          setStatus('idle');
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load ratings.');
          setStatus('idle');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, decisionId]);

  useEffect(() => {
    if (!modelId || !decisionId) return undefined;
    let cancelled = false;
    async function quietRefetch(): Promise<void> {
      try {
        const fresh = await listDecisionRatingsForDecision(supabase, decisionId);
        if (!cancelled) setRatings((prev) => mergeQuietRefetch(prev, fresh, pendingKeysRef.current));
      } catch {
        // A background refresh failing is not worth surfacing as a page
        // error — the next poll, or the tab regaining focus, tries again.
      }
    }
    function onVisibilityChange(): void {
      if (document.visibilityState === 'visible') void quietRefetch();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    const interval = setInterval(() => void quietRefetch(), QUIET_REFETCH_INTERVAL_MS);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(interval);
    };
  }, [modelId, decisionId]);

  const rateOption = useCallback(
    async (input: RateOptionInput): Promise<boolean> => {
      const note = input.note !== null && input.note.trim().length > 0 ? input.note.trim() : null;
      if (!isValidDecisionRatingNote(note)) {
        setError(`Note must be ${String(DECISION_RATING_NOTE_MAX_LENGTH)} characters or fewer.`);
        return false;
      }
      const key = ratingKey(input.optionId, input.criterion);
      pendingKeysRef.current.add(key);
      setError(null);
      setStatus('saving');
      const optimistic: DecisionOptionRatingRow = { decision_id: input.decisionId, branch_id: input.branchId, option_id: input.optionId, criterion: input.criterion, level: input.level, note, rated_by: input.userId, rated_at: new Date().toISOString() };
      setRatings((prev) => upsertRatingByKey(prev, optimistic));
      try {
        const saved = await upsertDecisionRating(supabase, { decisionId: input.decisionId, branchId: input.branchId, optionId: input.optionId, criterion: input.criterion, level: input.level, note, ratedBy: input.userId });
        setRatings((prev) => upsertRatingByKey(prev, saved));
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save this rating.');
        // Roll back by re-reading the real state for this one cell's own
        // table, rather than tracking a "previous row" snapshot per key —
        // simpler, and still only ever touches ratings data.
        try {
          const fresh = await listDecisionRatingsForDecision(supabase, decisionId);
          setRatings(fresh);
        } catch {
          // Rollback fetch itself failed — leave the optimistic value in
          // place rather than guess; the error message above already
          // tells the person the save didn't land.
        }
        return false;
      } finally {
        pendingKeysRef.current.delete(key);
        setStatus('idle');
      }
    },
    [decisionId],
  );

  return { ratings, status, error, rateOption };
}
