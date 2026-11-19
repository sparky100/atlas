import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { listDecisionOptionLinksForModel, listDecisionsForModel, type DecisionOptionLink } from '../../db/decisions';
import { listProjectsForModel } from '../../db/projects';
import type { DecisionRow, ProjectRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface ChangesHierarchyData {
  decisions: DecisionRow[];
  projects: ProjectRow[];
  optionLinks: DecisionOptionLink[];
}

/** What the Changes list needs to nest changes under decisions and projects. `null` while loading: the list shows its changes ungrouped until then. */
export function useChangesHierarchyData(modelId: UUID): ChangesHierarchyData | null {
  const [data, setData] = useState<ChangesHierarchyData | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([listDecisionsForModel(supabase, modelId), listProjectsForModel(supabase, modelId), listDecisionOptionLinksForModel(supabase, modelId)])
      .then(([decisions, projects, optionLinks]) => {
        if (!cancelled) setData({ decisions, projects, optionLinks });
      })
      .catch((e: unknown) => {
        reportError("Couldn't load the projects and decisions for this list.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [modelId]);
  return data;
}
