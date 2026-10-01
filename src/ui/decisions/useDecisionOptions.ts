import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { createChangeBranch, getMainBranch } from '../../db/branches';
import { chooseDecisionOption, createDecisionLink } from '../../db/decisions';
import type { BranchRow, DecisionLinkRow, DecisionRow } from '../../db/types';
import { supabase } from '../supabaseClient';

export type DecisionOptionsStatus = 'idle' | 'adding' | 'choosing';

export interface AddOptionInput {
  orgId: UUID;
  modelId: UUID;
  decisionId: UUID;
  name: string;
  title: string;
  userId: UUID;
  /** ADR-024 P1: the decision's own project — an option is always created in it (the database refuses a mismatched option link). */
  projectId: UUID | null;
}

export interface UseDecisionOptionsResult {
  status: DecisionOptionsStatus;
  error: string | null;
  /**
   * F3's own "Add an option" — creates a fresh `explore`-intent change
   * branch forked from main's current head, then links it to the decision
   * (`linked_type: 'branch'`). Pure composition of two already-existing
   * primitives (`createChangeBranch`, `createDecisionLink`), not a new
   * RPC — mirrors `useDecisions.ts`'s own reasoning for why creating a
   * decision and linking its initial concerns is two plain inserts, not
   * one atomic call.
   */
  addOption: (input: AddOptionInput) => Promise<boolean>;
  /** F3's own "Choose" — `atlas.choose_decision_option` in one call (`src/db/decisions.ts`'s `chooseDecisionOption`). */
  chooseOption: (decisionId: UUID, branchId: UUID, reasons: string) => Promise<boolean>;
}

/**
 * Neither action calls the decision page's own full `reload()` any more
 * (decision-side-completion follow-up: "Choose... still unmount[ed]
 * everything after each action") — each patches local state directly
 * from its own write's already-known result, the same "no full-page
 * loading state after the first load" approach `useDecisionRatings.ts`
 * already established for ratings. `addOption` needs no server re-read
 * at all (`createChangeBranch`/`createDecisionLink` already return
 * everything `applyNewOption` needs); `chooseOption` patches the decision
 * row immediately, then awaits `refreshOptionsAndArguments` for the one
 * side effect (every other option's status/intent) the RPC's own return
 * doesn't carry.
 *
 * Three direct callbacks, not one bundled object — a call site would
 * have to build a fresh object literal every render to pass a single
 * param, which would change identity every render even when the
 * individual callbacks are themselves `useCallback`-stable, defeating
 * the `useCallback` memoization below.
 */
export function useDecisionOptions(
  /** `useDecision.ts`'s own patch — see that file's doc comment. Called with `createChangeBranch`/`createDecisionLink`'s own already-known results; no re-fetch. */
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
      const trimmedName = input.name.trim();
      if (trimmedName.length === 0) {
        setError('Name cannot be empty.');
        return false;
      }
      setError(null);
      setStatus('adding');
      try {
        const main = await getMainBranch(supabase, input.modelId);
        if (!main?.head_commit_id) {
          setError('This model has no commits yet — there is nothing to base an option on.');
          return false;
        }
        const branch = await createChangeBranch(supabase, {
          id: crypto.randomUUID(),
          orgId: input.orgId,
          modelId: input.modelId,
          name: trimmedName,
          ...(input.title.trim().length > 0 ? { title: input.title.trim() } : {}),
          createdBy: input.userId,
          mainHeadCommitId: main.head_commit_id,
          intent: 'explore',
          projectId: input.projectId,
        });
        const link = await createDecisionLink(supabase, { decisionId: input.decisionId, linkedType: 'branch', linkedId: branch.id, createdBy: input.userId });
        applyNewOption(link, branch);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not add this option.');
        return false;
      } finally {
        setStatus('idle');
      }
    },
    [applyNewOption],
  );

  const chooseOption = useCallback(
    async (decisionId: UUID, branchId: UUID, reasons: string): Promise<boolean> => {
      if (reasons.trim().length === 0) {
        setError('Reasons are required.');
        return false;
      }
      setError(null);
      setStatus('choosing');
      try {
        const decision = await chooseDecisionOption(supabase, decisionId, branchId, reasons.trim());
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

  return { status, error, addOption, chooseOption };
}
