import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { checkGoalInput, type GoalCapabilityRow, type GoalInput, type GoalRow } from '../../contracts/goals';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { getMainBranch } from '../../db/branches';
import { listCapabilitiesForMap, listSupportsEdgesForAllCapabilities } from '../../db/capabilityMap';
import { createGoal, linkCapabilityToGoal, listGoalLinksForGoals, listGoalsForModel, unlinkCapabilityFromGoal, updateGoal } from '../../db/goals';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface UseGoalsResult {
  loading: boolean;
  goals: GoalRow[];
  links: GoalCapabilityRow[];
  /** Every capability on the live model (main). Goals are model-wide, not branch-scoped. */
  capabilities: ElementsHeadRow[];
  supportsEdges: RelationshipsHeadRow[];
  /** A short, plain-English message for the form, or `null`. */
  error: string | null;
  saving: boolean;
  create: (input: GoalInput) => Promise<boolean>;
  edit: (goalId: UUID, input: GoalInput) => Promise<boolean>;
  setStatus: (goalId: UUID, status: 'active' | 'retired') => Promise<boolean>;
  link: (goalId: UUID, capabilityId: UUID) => Promise<boolean>;
  unlink: (goalId: UUID, capabilityId: UUID) => Promise<boolean>;
}

const PROBLEM_TEXT: Record<string, string> = {
  'title-empty': 'Give the goal a title.',
  'title-too-long': 'The title is too long (120 characters at most).',
  'statement-empty': 'Say what success looks like in a sentence or two.',
  'statement-too-long': 'That is too long (500 characters at most).',
  'why-now-too-long': 'The "why now" note is too long (500 characters at most).',
};

/** Every goal on a model, its links, the capabilities it can point at, and the create / edit / retire / link actions. The database (RLS and the triggers) is the real gate. */
export function useGoals(modelId: UUID, orgId: UUID, userId: UUID | null): UseGoalsResult {
  const [loading, setLoading] = useState(true);
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [links, setLinks] = useState<GoalCapabilityRow[]>([]);
  const [capabilities, setCapabilities] = useState<ElementsHeadRow[]>([]);
  const [supportsEdges, setSupportsEdges] = useState<RelationshipsHeadRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([listGoalsForModel(supabase, modelId), getMainBranch(supabase, modelId)])
      .then(async ([rows, main]) => {
        const commitId = main?.head_commit_id ?? null;
        const [linkRows, caps, edges] = await Promise.all([
          listGoalLinksForGoals(supabase, rows.map((g) => g.id)),
          commitId === null ? Promise.resolve([]) : listCapabilitiesForMap(supabase, commitId),
          commitId === null ? Promise.resolve([]) : listSupportsEdgesForAllCapabilities(supabase, commitId),
        ]);
        if (cancelled) return;
        setGoals(rows);
        setLinks(linkRows);
        setCapabilities(caps);
        setSupportsEdges(edges);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError("Couldn't load this model's goals.");
        setLoading(false);
        reportError("Couldn't load this model's goals.", e);
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
    async (input: GoalInput): Promise<boolean> => {
      if (!userId) {
        setError('You must be signed in to add a goal.');
        return false;
      }
      const checked = checkGoalInput(input);
      if (!checked.ok) {
        setError(PROBLEM_TEXT[checked.problem] ?? 'Check the goal and try again.');
        return false;
      }
      return run('Could not add this goal.', async () => {
        await createGoal(supabase, { id: crypto.randomUUID(), orgId, modelId, ...checked.value, createdBy: userId });
      });
    },
    [modelId, orgId, userId, run],
  );

  const edit = useCallback(
    async (goalId: UUID, input: GoalInput): Promise<boolean> => {
      const checked = checkGoalInput(input);
      if (!checked.ok) {
        setError(PROBLEM_TEXT[checked.problem] ?? 'Check the goal and try again.');
        return false;
      }
      return run('Could not save this goal.', () => updateGoal(supabase, goalId, checked.value));
    },
    [run],
  );

  const setStatus = useCallback((goalId: UUID, status: 'active' | 'retired') => run(status === 'retired' ? 'Could not retire this goal.' : 'Could not make this goal active again.', () => updateGoal(supabase, goalId, { status })), [run]);

  const link = useCallback(
    (goalId: UUID, capabilityId: UUID): Promise<boolean> => {
      if (!userId) {
        setError('You must be signed in to link a capability.');
        return Promise.resolve(false);
      }
      return run('Could not link that capability.', async () => {
        await linkCapabilityToGoal(supabase, { goalId, capabilityId, createdBy: userId });
      });
    },
    [run, userId],
  );

  const unlink = useCallback((goalId: UUID, capabilityId: UUID) => run('Could not remove that link.', () => unlinkCapabilityFromGoal(supabase, goalId, capabilityId)), [run]);

  return { loading, goals, links, capabilities, supportsEdges, error, saving, create, edit, setStatus, link, unlink };
}
