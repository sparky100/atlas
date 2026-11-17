import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { checkPrincipleInput, type DecisionPrincipleRow, type PrincipleInput, type PrincipleRow } from '../../contracts/principles';
import { listDecisionsForModel } from '../../db/decisions';
import { createPrinciple, listPrincipleLinksForPrinciples, listPrinciplesForModel, updatePrinciple } from '../../db/principles';
import type { DecisionRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface UsePrinciplesResult {
  loading: boolean;
  principles: PrincipleRow[];
  links: DecisionPrincipleRow[];
  decisions: DecisionRow[];
  /** A short, plain-English message for the form, or `null`. */
  error: string | null;
  saving: boolean;
  create: (input: PrincipleInput) => Promise<boolean>;
  edit: (principleId: UUID, input: PrincipleInput) => Promise<boolean>;
  setStatus: (principleId: UUID, status: 'active' | 'retired') => Promise<boolean>;
  /** Reads the list again, e.g. after principles were added from a set. */
  reload: () => void;
}

const PROBLEM_TEXT: Record<string, string> = {
  'title-empty': 'Give the principle a title.',
  'title-too-long': 'The title is too long (120 characters at most).',
  'statement-empty': 'Write the rule in a sentence or two.',
  'statement-too-long': 'The rule is too long (500 characters at most).',
  'why-too-long': 'The reason is too long (1,000 characters at most).',
};

/** Every principle on a model, the decisions that cite them, and the create / edit / retire actions. The database (RLS and the guard trigger) is the real gate. */
export function usePrinciples(modelId: UUID, orgId: UUID, userId: UUID | null): UsePrinciplesResult {
  const [loading, setLoading] = useState(true);
  const [principles, setPrinciples] = useState<PrincipleRow[]>([]);
  const [links, setLinks] = useState<DecisionPrincipleRow[]>([]);
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([listPrinciplesForModel(supabase, modelId), listDecisionsForModel(supabase, modelId)])
      .then(async ([rows, decisionRows]) => {
        const linkRows = await listPrincipleLinksForPrinciples(supabase, rows.map((p) => p.id));
        if (cancelled) return;
        setPrinciples(rows);
        setDecisions(decisionRows);
        setLinks(linkRows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError("Couldn't load this model's principles.");
        setLoading(false);
        reportError("Couldn't load this model's principles.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  const run = useCallback(
    async (failure: string, work: () => Promise<void>): Promise<boolean> => {
      setError(null);
      setSaving(true);
      try {
        await work();
        setSaving(false);
        reload();
        return true;
      } catch (e) {
        setSaving(false);
        setError(failure);
        reportError(failure, e);
        return false;
      }
    },
    [reload],
  );

  const create = useCallback(
    async (input: PrincipleInput): Promise<boolean> => {
      if (!userId) {
        setError('You must be signed in to add a principle.');
        return false;
      }
      const checked = checkPrincipleInput(input);
      if (!checked.ok) {
        setError(PROBLEM_TEXT[checked.problem] ?? 'Check the principle and try again.');
        return false;
      }
      return run('Could not add this principle.', async () => {
        await createPrinciple(supabase, { id: crypto.randomUUID(), orgId, modelId, ...checked.value, createdBy: userId });
      });
    },
    [modelId, orgId, userId, run],
  );

  const edit = useCallback(
    async (principleId: UUID, input: PrincipleInput): Promise<boolean> => {
      const checked = checkPrincipleInput(input);
      if (!checked.ok) {
        setError(PROBLEM_TEXT[checked.problem] ?? 'Check the principle and try again.');
        return false;
      }
      return run('Could not save this principle.', () => updatePrinciple(supabase, principleId, checked.value));
    },
    [run],
  );

  const setStatus = useCallback((principleId: UUID, status: 'active' | 'retired') => run(status === 'retired' ? 'Could not retire this principle.' : 'Could not make this principle active again.', () => updatePrinciple(supabase, principleId, { status })), [run]);

  return { loading, principles, links, decisions, error, saving, create, edit, setStatus, reload };
}
