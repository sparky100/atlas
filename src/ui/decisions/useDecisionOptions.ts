import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { createChangeBranch, getMainBranch } from '../../db/branches';
import { chooseDecisionOption, createDecisionLink } from '../../db/decisions';
import { supabase } from '../supabaseClient';

export type DecisionOptionsStatus = 'idle' | 'adding' | 'choosing';

export interface AddOptionInput {
  orgId: UUID;
  modelId: UUID;
  decisionId: UUID;
  name: string;
  title: string;
  userId: UUID;
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

/** `onDone` is called after either action succeeds — the caller's own `reload()` (`useDecision.ts`), so the decision page's links/comparison table/status all refresh from the one source of truth rather than this hook guessing at optimistic local state. */
export function useDecisionOptions(onDone: () => void): UseDecisionOptionsResult {
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
        });
        await createDecisionLink(supabase, { decisionId: input.decisionId, linkedType: 'branch', linkedId: branch.id, createdBy: input.userId });
        onDone();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not add this option.');
        return false;
      } finally {
        setStatus('idle');
      }
    },
    [onDone],
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
        await chooseDecisionOption(supabase, decisionId, branchId, reasons.trim());
        onDone();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not choose this option.');
        return false;
      } finally {
        setStatus('idle');
      }
    },
    [onDone],
  );

  return { status, error, addOption, chooseOption };
}
