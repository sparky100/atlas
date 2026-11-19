import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { isValidStanceReason, type DecisionPrincipleRow, type PrincipleRow, type PrincipleStance } from '../../contracts/principles';
import { linkPrincipleToDecision, listPrinciplesForDecision, listPrinciplesForModel, unlinkPrincipleFromDecision } from '../../db/principles';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface UseDecisionPrinciplesResult {
  loading: boolean;
  principles: PrincipleRow[];
  /** The saved links, with any stance being saved shown as already chosen so a click never looks undone while it saves. */
  links: DecisionPrincipleRow[];
  /** A short, plain-English message for the panel, or `null`. */
  error: string | null;
  /** The principles whose stance is saving now. Only their own cards lock; the rest of the panel stays as it was. */
  savingIds: ReadonlySet<string>;
  /** Takes a view on a principle: `follows`, `departs` (with a reason), or `null` to take none. Returns whether it saved. */
  setStance: (principleId: UUID, stance: PrincipleStance | null, reason: string) => Promise<boolean>;
}

/** The model's principles and one decision's links to them (ADR-034 PR 3). The database (RLS and the triggers) is the real gate: only while the decision is proposed, only an active principle from this model. */
export function useDecisionPrinciples(modelId: UUID, decisionId: UUID, userId: UUID | null): UseDecisionPrinciplesResult {
  const [loading, setLoading] = useState(true);
  const [principles, setPrinciples] = useState<PrincipleRow[]>([]);
  const [links, setLinks] = useState<DecisionPrincipleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlyMap<string, { stance: PrincipleStance | null; reason: string }>>(new Map());
  const [reloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listPrinciplesForModel(supabase, modelId), listPrinciplesForDecision(supabase, decisionId)])
      .then(([rows, linkRows]) => {
        if (cancelled) return;
        setPrinciples(rows);
        setLinks(linkRows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoading(false);
        setError("Couldn't load the principles.");
        reportError("Couldn't load the principles.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, decisionId, reloadToken]);

  const setStance = useCallback(
    async (principleId: UUID, stance: PrincipleStance | null, reason: string): Promise<boolean> => {
      if (!userId) {
        setError('You must be signed in to do this.');
        return false;
      }
      if (stance !== null && !isValidStanceReason(stance, reason.trim())) {
        setError('A departure needs a reason, in a sentence or so (500 characters at most).');
        return false;
      }
      setError(null);
      setPending((prev) => new Map(prev).set(principleId, { stance, reason: reason.trim() }));
      try {
        // A link has no update path (a decision's stance is a record), so a change is take-back-then-add.
        if (links.some((l) => l.principle_id === principleId)) await unlinkPrincipleFromDecision(supabase, decisionId, principleId);
        if (stance !== null) await linkPrincipleToDecision(supabase, { decisionId, principleId, stance, reason: reason.trim(), createdBy: userId });
        return true;
      } catch (e) {
        setError('Could not save this. Reload the page and try again.');
        reportError('Could not save this principle stance.', e);
        return false;
      } finally {
        // Read the saved links back first, then drop the "already chosen" overlay, so the choice never blinks off in between.
        try {
          setLinks(await listPrinciplesForDecision(supabase, decisionId));
        } catch (e) {
          reportError("Couldn't reload the principles.", e);
        }
        setPending((prev) => {
          const next = new Map(prev);
          next.delete(principleId);
          return next;
        });
      }
    },
    [decisionId, links, userId],
  );

  const savingIds = useMemo<ReadonlySet<string>>(() => new Set(pending.keys()), [pending]);
  const shownLinks = useMemo(() => {
    if (pending.size === 0) return links;
    const kept = links.filter((l) => !pending.has(l.principle_id));
    const added: DecisionPrincipleRow[] = [];
    for (const [principleId, { stance, reason }] of pending) {
      if (stance !== null) added.push({ decision_id: decisionId, principle_id: principleId, stance, reason, created_by: userId ?? '', created_at: '' });
    }
    return [...kept, ...added];
  }, [links, pending, decisionId, userId]);

  return { loading, principles, links: shownLinks, error, savingIds, setStance };
}
