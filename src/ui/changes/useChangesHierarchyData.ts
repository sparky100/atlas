import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { listDecisionsForModel } from '../../db/decisions';
import { listDecisionOptionsForModel } from '../../db/decisionOptions';
import { listProjectsForModel } from '../../db/projects';
import type { DecisionOptionRow, DecisionRow, ProjectRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface ChangesHierarchyData {
  decisions: DecisionRow[];
  projects: ProjectRow[];
  options: DecisionOptionRow[];
}

/** What the Changes list needs to nest changes under decisions and projects. `null` while loading: the list shows its changes ungrouped until then. */
export function useChangesHierarchyData(modelId: UUID): ChangesHierarchyData | null {
  const [data, setData] = useState<ChangesHierarchyData | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([listDecisionsForModel(supabase, modelId), listProjectsForModel(supabase, modelId), listDecisionOptionsForModel(supabase, modelId)])
      .then(([decisions, projects, options]) => {
        if (!cancelled) setData({ decisions, projects, options });
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
