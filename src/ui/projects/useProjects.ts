import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { addProjectLink, createProject, listProjectsForModel } from '../../db/projects';
import type { ProjectRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export type ProjectsStatus = 'loading' | 'idle' | 'creating';

export interface CreateProjectFormInput {
  title: string;
  purpose: string;
  ownerId: UUID;
  projectManagerId?: UUID | null;
  projectManagerName?: string | null;
  /** ISO `YYYY-MM-DD`, or `''` for none. */
  startDate: string;
  targetDate: string;
  sourceFindingKey?: string;
  /** Declared scope (ADR-024 `project_links` 'element'): the capabilities and systems the project is about. */
  scopeElementIds: UUID[];
}

export interface UseProjectsResult {
  status: ProjectsStatus;
  projects: ProjectRow[];
  error: string | null;
  createProjectWithScope: (input: CreateProjectFormInput) => Promise<ProjectRow | null>;
  reload: () => void;
}

/**
 * F10 step 2: every project on a model, and the create action. Same shape
 * as `useDecisions.ts` — the database (RLS `projects_insert`, the
 * `project_links` checks) does the real validation.
 */
export function useProjects(modelId: UUID, orgId: UUID, userId: UUID | null): UseProjectsResult {
  const [status, setStatus] = useState<ProjectsStatus>('loading');
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    listProjectsForModel(supabase, modelId)
      .then((rows) => {
        if (cancelled) return;
        setProjects(rows);
        setStatus('idle');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError("Couldn't load this model's projects.");
        setStatus('idle');
        reportError("Couldn't load this model's projects.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  const createProjectWithScope = useCallback(
    async (input: CreateProjectFormInput): Promise<ProjectRow | null> => {
      if (!userId) {
        setError('You must be signed in to start a project.');
        return null;
      }
      const title = input.title.trim();
      if (title.length === 0) {
        setError('Title cannot be empty.');
        return null;
      }
      if (input.startDate !== '' && input.targetDate !== '' && input.targetDate < input.startDate) {
        setError('The target date is before the start date.');
        return null;
      }
      setError(null);
      setStatus('creating');
      try {
        const project = await createProject(supabase, {
          id: crypto.randomUUID(),
          orgId,
          modelId,
          title,
          purpose: input.purpose.trim(),
          ownerId: input.ownerId,
          projectManagerId: input.projectManagerId ?? null,
          projectManagerName: input.projectManagerName?.trim() ? input.projectManagerName.trim() : null,
          startDate: input.startDate === '' ? null : input.startDate,
          targetDate: input.targetDate === '' ? null : input.targetDate,
          sourceFindingKey: input.sourceFindingKey ?? null,
          createdBy: userId,
        });
        // A second insert per scope element — project_links' own RLS needs the
        // project to exist first. A failure here leaves a real project with
        // less scope than intended, surfaced here, never an abandoned project.
        for (const elementId of input.scopeElementIds) {
          await addProjectLink(supabase, { projectId: project.id, linkedType: 'element', linkedId: elementId, createdBy: userId });
        }
        setStatus('idle');
        reload();
        return project;
      } catch (e) {
        setStatus('idle');
        setError('Could not start this project.');
        reportError('Could not start this project.', e);
        return null;
      }
    },
    [modelId, orgId, userId, reload],
  );

  return { status, projects, error, createProjectWithScope, reload };
}
