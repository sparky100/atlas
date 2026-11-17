import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { GoalCapabilityRow, GoalRow } from '../../contracts/goals';
import { listGoalLinksForGoals, listGoalsForModel } from '../../db/goals';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface ModelGoals {
  goals: GoalRow[];
  links: GoalCapabilityRow[];
}

/** Every goal on a model and its links, read once (for the capability map's "Show goal", the homes' count and the decision export). `null` until read, and left `null` if the read fails (whatever depends on goals is then simply not shown). */
export function useModelGoals(modelId: UUID): ModelGoals | null {
  const [state, setState] = useState<ModelGoals | null>(null);
  useEffect(() => {
    if (modelId === '') return;
    let cancelled = false;
    listGoalsForModel(supabase, modelId)
      .then(async (goals) => {
        const links = await listGoalLinksForGoals(supabase, goals.map((g) => g.id));
        if (!cancelled) setState({ goals, links });
      })
      .catch((e: unknown) => {
        reportError("Couldn't read this model's goals.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [modelId]);
  return state;
}
