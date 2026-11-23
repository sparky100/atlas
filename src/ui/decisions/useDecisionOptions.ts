import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { chooseDecisionOption, updateDecision } from '../../db/decisions';
import { createDecisionOption, workOnDecisionOption } from '../../db/decisionOptions';
import type { BranchRow, DecisionLinkRow, DecisionOptionRow, DecisionRow } from '../../db/types';
import { supabase } from '../supabaseClient';
import { addBaseline, type AddBaselineInput } from './addBaseline';

export type DecisionOptionsStatus = 'idle' | 'adding' | 'choosing' | 'baseline' | 'working';

export interface AddOptionInput {
  decisionId: UUID;
  /** What the person typed. No delivery branch is created until someone works on it. */
  title: string;
  userId: UUID;
}

export interface UseDecisionOptionsResult {
  status: DecisionOptionsStatus;
  error: string | null;
  /**
   * F3's own "Add an option" - writes a candidate row with no delivery
   * branch. The branch is created only by `workOnOption`, so adding a
   * candidate does not appear in the Changes list or reserve a branch.
   */
  addOption: (input: AddOptionInput) => Promise<boolean>;
  /** Creates the delivery branch only when this option is actually worked on, then refreshes the page data. */
  workOnOption: (optionId: UUID) => Promise<BranchRow | null>;
  /** Gives a decision that has none its "Stay as we are" baseline option (`addBaseline.ts`). */
  addBaselineOption: (input: AddBaselineInput) => Promise<boolean>;
  /** Saves the baseline's two plain-text answers (operational risk of staying, what speaks for staying, or holds us back from changing). */
  saveBaselineText: (decisionId: UUID, stayRisk: string, stayReason: string) => Promise<boolean>;
  /** F3's own "Choose" — `atlas.choose_decision_option` in one call (`src/db/decisions.ts`'s `chooseDecisionOption`). Optionally records what would make the choice be reconsidered, and a review date. */
  chooseOption: (decisionId: UUID, optionId: UUID | null, branchId: UUID | null, reasons: string, reconsider?: { reconsiderIf: string; reviewBy: string }) => Promise<boolean>;
}

/**
 * Neither action calls the decision page's own full `reload()` any more
 * (decision-side-completion follow-up: "Choose... still unmount[ed]
 * everything after each action") — each patches local state directly
 * from its own write's already-known result, the same "no full-page
 * loading state after the first load" approach `useDecisionRatings.ts`
 * already established for ratings. `addOption` patches in the candidate
 * row it just wrote; `workOnOption` and `chooseOption` await
 * `refreshOptionsAndArguments` for the branch/link/status changes their
 * RPCs make beyond the single row each can return.
 *
 * Four direct callbacks, not one bundled object - a call site would
 * have to build a fresh object literal every render to pass a single
 * param, which would change identity every render even when the
 * individual callbacks are themselves `useCallback`-stable, defeating
 * the `useCallback` memoization below.
 */
export function useDecisionOptions(
  /** `useDecision.ts`'s own candidate patch - the branchless Add-an-option path. */
  applyCreatedOption: (option: DecisionOptionRow) => void,
  /** `useDecision.ts`'s own patch - see that file's doc comment. Called with an add-baseline/suggested-option branch and link; no re-fetch. */
  applyNewOption: (link: DecisionLinkRow, branch: BranchRow) => void,
  /** `useDecision.ts`'s own patch — called with `chooseDecisionOption`'s own return value; no re-fetch. */
  applyDecisionUpdate: (decision: DecisionRow) => void,
  /** `useDecision.ts`'s own targeted refresh for exactly what Choose's RPC changes beyond the decision row itself (every option branch's status, the new argument row) — see that file's doc comment. */
  refreshOptionsAndArguments: () => Promise<void>,
): UseDecisionOptionsResult {
  const [status, setStatus] = useState<DecisionOptionsStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const addOption = useCallback(
    async (input: AddOptionInput): Promise<boolean> => {
      const trimmedTitle = input.title.trim();
      if (trimmedTitle.length === 0) {
        setError('Say what this option is first.');
        return false;
      }
      setError(null);
      setStatus('adding');
      try {
        const option = await createDecisionOption(supabase, { decisionId: input.decisionId, title: trimmedTitle, createdBy: input.userId });
        applyCreatedOption(option);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not add this option.');
        return false;
      } finally {
        setStatus('idle');
      }
    },
    [applyCreatedOption],
  );

  const workOnOption = useCallback(
    async (optionId: UUID): Promise<BranchRow | null> => {
      setError(null);
      setStatus('working');
      try {
        const branch = await workOnDecisionOption(supabase, optionId);
        await refreshOptionsAndArguments();
        return branch;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not start work on this option.');
        return null;
      } finally {
        setStatus('idle');
      }
    },
    [refreshOptionsAndArguments],
  );

  const addBaselineOption = useCallback(
    async (input: AddBaselineInput): Promise<boolean> => {
      setError(null);
      setStatus('baseline');
      try {
        const added = await addBaseline(input);
        applyNewOption(added.link, added.branch);
        applyDecisionUpdate(added.decision);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not add the baseline.');
        return false;
      } finally {
        setStatus('idle');
      }
    },
    [applyNewOption, applyDecisionUpdate],
  );

  const saveBaselineText = useCallback(
    async (decisionId: UUID, stayRisk: string, stayReason: string): Promise<boolean> => {
      setError(null);
      setStatus('baseline');
      try {
        applyDecisionUpdate(await updateDecision(supabase, decisionId, { stayRisk: stayRisk.trim(), stayReason: stayReason.trim() }));
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save the baseline.');
        return false;
      } finally {
        setStatus('idle');
      }
    },
    [applyDecisionUpdate],
  );

  const chooseOption = useCallback(
    async (decisionId: UUID, optionId: UUID | null, branchId: UUID | null, reasons: string, reconsider?: { reconsiderIf: string; reviewBy: string }): Promise<boolean> => {
      if (reasons.trim().length === 0) {
        setError('Reasons are required.');
        return false;
      }
      setError(null);
      setStatus('choosing');
      try {
        let chosenBranchId = branchId;
        if (chosenBranchId === null) {
          if (optionId === null) {
            setError('This option has no change to choose yet.');
            return false;
          }
          chosenBranchId = (await workOnDecisionOption(supabase, optionId)).id;
        }
        const decision = await chooseDecisionOption(supabase, decisionId, chosenBranchId, reasons.trim(), {
          ...(reconsider !== undefined && reconsider.reconsiderIf.trim().length > 0 ? { reconsiderIf: reconsider.reconsiderIf.trim() } : {}),
          ...(reconsider !== undefined && reconsider.reviewBy.length > 0 ? { reviewBy: reconsider.reviewBy } : {}),
        });
        applyDecisionUpdate(decision);
        await refreshOptionsAndArguments();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not choose this option.');
        return false;
      } finally {
        setStatus('idle');
      }
    },
    [applyDecisionUpdate, refreshOptionsAndArguments],
  );

  return { status, error, addOption, workOnOption, addBaselineOption, saveBaselineText, chooseOption };
}
