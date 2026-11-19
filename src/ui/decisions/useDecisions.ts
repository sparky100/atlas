import { addBaseline } from './addBaseline';
import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { createDecision, createDecisionLink, listDecisionsForModel } from '../../db/decisions';
import type { DecisionLinkedType, DecisionRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export type DecisionsStatus = 'loading' | 'idle' | 'creating';

export interface CreateDecisionLinkInput {
  linkedType: DecisionLinkedType;
  linkedId: UUID;
}

export interface CreateDecisionInput {
  title: string;
  /** F3's own "context" — written before any option exists. */
  statement: string;
  ownerId: UUID;
  /** ISO `date` string (`YYYY-MM-DD`), or `''` for none. */
  neededBy: string;
  sourceFindingKey?: string;
  lensMapUrl?: string;
  /** The capability/system(s) this decision concerns — "context/owner/needed-by/capability+systems" (F3's own creation-form field list). Linked in the same action, after the decision row exists (`decision_links_insert`'s own RLS needs a real `decision_id` to check against). */
  links: CreateDecisionLinkInput[];
}

export interface UseDecisionsResult {
  status: DecisionsStatus;
  decisions: DecisionRow[];
  error: string | null;
  createDecisionWithLinks: (input: CreateDecisionInput) => Promise<DecisionRow | null>;
  reload: () => void;
}

/**
 * Prompt pack F3 PR4's "Decisions" list: every decision on this model, and
 * the "create decision" action. Mirrors `useChanges.ts`'s own shape
 * (load/error/reload plumbing around one real create call) — `createDecision`
 * (`src/db/decisions.ts`) does the real work (RLS's role + `status='proposed'`
 * check, `decisions_insert`'s WITH CHECK).
 */
export function useDecisions(modelId: UUID, orgId: UUID, userId: UUID | null): UseDecisionsResult {
  const [status, setStatus] = useState<DecisionsStatus>('loading');
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    listDecisionsForModel(supabase, modelId)
      .then((rows) => {
        if (cancelled) return;
        setDecisions(rows);
        setStatus('idle');
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't load this model's decisions.");
          setStatus('idle');
          reportError("Couldn't load this model's decisions.", e);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  const createDecisionWithLinks = useCallback(
    async (input: CreateDecisionInput): Promise<DecisionRow | null> => {
      if (!userId) {
        setError('You must be signed in to start a decision.');
        return null;
      }
      const trimmedTitle = input.title.trim();
      if (trimmedTitle.length === 0) {
        setError('Title cannot be empty.');
        return null;
      }
      setError(null);
      setStatus('creating');
      try {
        const decision = await createDecision(supabase, {
          id: crypto.randomUUID(),
          orgId,
          modelId,
          title: trimmedTitle,
          statement: input.statement.trim(),
          ownerId: input.ownerId,
          ...(input.neededBy.trim().length > 0 ? { neededBy: input.neededBy.trim() } : {}),
          ...(input.sourceFindingKey ? { sourceFindingKey: input.sourceFindingKey } : {}),
          ...(input.lensMapUrl && input.lensMapUrl.trim().length > 0 ? { lensMapUrl: input.lensMapUrl.trim() } : {}),
          createdBy: userId,
        });
        // Links are a second, independent insert per link — decisions_links'
        // own RLS needs the decision to already exist (a `decision_id` it
        // can join back to), so this can't be one round trip with the
        // decision itself. A link failing here leaves a real decision with
        // fewer links than intended, surfaced through this same error state
        // — never a silently abandoned decision, since the decision row
        // itself already committed.
        for (const link of input.links) {
          await createDecisionLink(supabase, { decisionId: decision.id, linkedType: link.linkedType, linkedId: link.linkedId, createdBy: userId });
        }
        // Every decision starts with its "Stay as we are" baseline. If this fails the
        // decision stands without one and the decision page offers "Add the baseline".
        await addBaseline({ orgId, modelId, decisionId: decision.id, userId, projectId: decision.project_id }).catch((e: unknown) => {
          reportError('Could not add the baseline to the new decision.', e);
        });
        setStatus('idle');
        reload();
        return decision;
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Could not start this decision.';
        setStatus('idle');
        setError(message);
        reportError('Could not start this decision.', e);
        return null;
      }
    },
    [modelId, orgId, userId, reload],
  );

  return { status, decisions, error, createDecisionWithLinks, reload };
}
