import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { listChangeBranches } from '../../db/branches';
import { listDecisionOptionLinksForModel, listDecisionsForModel } from '../../db/decisions';
import { listProjectsForModel } from '../../db/projects';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { buildWorkLists, type WorkLists } from './workLists';

/** The open projects, decisions and changes of a model, grouped for the Work overview. `null` while loading. */
export function useWorkLists(modelId: UUID | null): WorkLists | null {
  const [lists, setLists] = useState<WorkLists | null>(null);
  useEffect(() => {
    if (!modelId) return undefined;
    let cancelled = false;
    Promise.all([listChangeBranches(supabase, modelId), listDecisionsForModel(supabase, modelId), listProjectsForModel(supabase, modelId), listDecisionOptionLinksForModel(supabase, modelId)])
      .then(([branches, decisions, projects, links]) => {
        if (!cancelled) setLists(buildWorkLists(branches, decisions, projects, links));
      })
      .catch((e: unknown) => {
        reportError("Couldn't load the open work.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [modelId]);
  return lists;
}
