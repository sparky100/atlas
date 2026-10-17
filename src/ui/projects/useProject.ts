import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { getMainBranch } from '../../db/branches';
import { loadChangeSummariesForModel } from '../../db/changeSummary';
import { getElementsByIds } from '../../db/elements';
import { containerParentIds } from '../elements/moduleDisplayName';
import { listEvidenceForModel } from '../../db/evidence';
import {
  getProject,
  listChangesForProject,
  listConstrainingDecisions,
  listDecisionsForProject,
  listElementsTouchedByChange,
  listProjectLinks,
  type TouchedElement,
} from '../../db/projects';
import type { BranchRow, DecisionRow, EvidenceRow, ProjectLinkRow, ProjectRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface ProjectData {
  project: ProjectRow;
  /** The decision log: decisions that are part of this project, oldest first. */
  decisions: DecisionRow[];
  /** Decisions that constrain this project without being part of it. */
  constrainingDecisions: DecisionRow[];
  changes: BranchRow[];
  links: ProjectLinkRow[];
  evidence: EvidenceRow[];
  /** Every element any of the project's changes touches, with its name where known. */
  touched: TouchedElement[];
  /** Every capability, value stream and stage any of the project's changes affects (change impact, ADR-024 §8 and ADR-023's amendment) — the full list, collapsed ones included. A scope item here is covered by the work even when no change edits it. */
  reachedIds: UUID[];
  /** Scope and touched elements that exist on main, plus each module's own platform so it can be named "Platform · Module". */
  elementsById: Map<UUID, ElementsHeadRow>;
}

export type ProjectState = { status: 'loading' } | { status: 'not_found' } | { status: 'error'; message: string } | { status: 'ready'; data: ProjectData };

export interface UseProjectResult {
  state: ProjectState;
  reload: () => void;
}

/**
 * F10 step 3: everything the project page shows, in one load. "What the
 * project touches" and its progress are derived here and in
 * `projectModel.ts`, never stored (ADR-024 §5).
 */
export function useProject(modelId: UUID, projectId: UUID): UseProjectResult {
  const [state, setState] = useState<ProjectState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!modelId || !projectId) return;
    // Read through a function: inside the async closure TypeScript would
    // otherwise narrow the flag to its initial `false` across awaits.
    const guard = { cancelled: false };
    const isCancelled = () => guard.cancelled;
    void (async () => {
      try {
        const project = await getProject(supabase, projectId);
        if (isCancelled()) return;
        if (project?.model_id !== modelId) {
          setState({ status: 'not_found' });
          return;
        }
        const [decisions, constrainingDecisions, changes, links, main] = await Promise.all([
          listDecisionsForProject(supabase, projectId),
          listConstrainingDecisions(supabase, projectId),
          listChangesForProject(supabase, projectId),
          listProjectLinks(supabase, projectId),
          getMainBranch(supabase, modelId),
        ]);
        const touchedLists = await Promise.all(changes.map((c) => listElementsTouchedByChange(supabase, modelId, c.id)));
        const touchedById = new Map<UUID, TouchedElement>();
        for (const list of touchedLists) {
          for (const t of list) {
            const existing = touchedById.get(t.elementId);
            if (!existing) touchedById.set(t.elementId, { ...t });
            else if (existing.createdName === null && t.createdName !== null) existing.createdName = t.createdName;
          }
        }
        const scopeIds = links.filter((l) => l.linked_type === 'element').map((l) => l.linked_id);
        const evidenceIds = new Set(links.filter((l) => l.linked_type === 'evidence').map((l) => l.linked_id));
        const elementIds = [...new Set([...scopeIds, ...touchedById.keys()])];
        const [elementsById, evidence, summaries] = await Promise.all([
          main?.head_commit_id ? getElementsByIds(supabase, main.head_commit_id, elementIds) : Promise.resolve(new Map<UUID, ElementsHeadRow>()),
          evidenceIds.size === 0 ? Promise.resolve([] as EvidenceRow[]) : listEvidenceForModel(supabase, modelId).then((rows) => rows.filter((r) => evidenceIds.has(r.id))),
          loadChangeSummariesForModel(supabase, modelId, changes),
        ]);
        const reachedIds = new Set<UUID>();
        for (const summary of summaries.values()) {
          for (const ac of summary.affectedCapabilities) reachedIds.add(ac.capability.element_id);
          for (const vs of summary.affectedValueStreams) {
            reachedIds.add(vs.stream.element_id);
            for (const st of vs.stages) reachedIds.add(st.stage.element_id);
          }
        }
        // A module reads "Platform · Module" (`moduleDisplayName.ts`), so its
        // platform has to be in the same map — fetched only when a scope or
        // touched element is actually a container with a platform not
        // already loaded.
        const missingParentIds = containerParentIds(elementsById.values()).filter((id) => !elementsById.has(id));
        if (main?.head_commit_id && missingParentIds.length > 0) {
          for (const [id, row] of await getElementsByIds(supabase, main.head_commit_id, missingParentIds)) elementsById.set(id, row);
        }
        if (isCancelled()) return;
        setState({ status: 'ready', data: { project, decisions, constrainingDecisions, changes, links, evidence, touched: [...touchedById.values()], reachedIds: [...reachedIds], elementsById } });
      } catch (e) {
        if (isCancelled()) return;
        setState({ status: 'error', message: "Couldn't load this project." });
        reportError("Couldn't load this project.", e);
      }
    })();
    return () => {
      guard.cancelled = true;
    };
  }, [modelId, projectId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  return { state, reload };
}

