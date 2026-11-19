import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { getMainBranch } from '../../db/branches';
import { loadChangeSummariesForModel } from '../../db/changeSummary';
import { getElementsByIds } from '../../db/elements';
import { deriveCapabilitiesForScope } from '../../db/healthFindings';
import { listSupportsEdgesForSystems } from '../../db/landscape';
import { listSupportsEdgesForCapabilities } from '../../db/capabilityMap';
import { lifecycleStateOf } from '../../engine/elementRead/fitAndExposure';
import type { JourneyCapability } from './projectJourney';
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
  /** A1b: whether the declared scope already names at least one capability — a project can't stand apart from a capability (A1a enforces it at creation; this surfaces the gap for projects made before it). */
  scopeHasCapability: boolean;
  /** A1b: capabilities the project's scoped systems and modules already support, offered to add to the scope in one click — empty when there is nothing to derive, or when the scope already names a capability. */
  derivedCapabilityCandidates: { id: UUID; name: string }[];
  /** B1 (journey strip, "how it might be met"): each capability in the declared scope with the live systems that already support it — an estate query, never stored. */
  journeyCapabilities: JourneyCapability[];
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
        // A1b: does the declared scope name a capability, and if not, which
        // capabilities do its scoped systems support? Derived only when the
        // project is open and names none — a closed project, or one that
        // already has a capability, needs neither the prompt nor the query.
        const scopeHasCapability = scopeIds.some((id) => elementsById.get(id)?.element_type === 'capability');
        const isOpen = project.status === 'active' || project.status === 'on_hold';
        let derivedCapabilityCandidates: { id: UUID; name: string }[] = [];
        if (isOpen && !scopeHasCapability && main?.head_commit_id) {
          const scopedSystemIds = scopeIds.filter((id) => {
            const type = elementsById.get(id)?.element_type;
            return type === 'system' || type === 'container';
          });
          if (scopedSystemIds.length > 0) {
            const supportsEdges = await listSupportsEdgesForSystems(supabase, main.head_commit_id, scopedSystemIds);
            const candidateIds = [...new Set(supportsEdges.map((e) => e.to_element_id))].filter((id) => !elementsById.has(id));
            if (candidateIds.length > 0) {
              for (const [id, row] of await getElementsByIds(supabase, main.head_commit_id, candidateIds)) elementsById.set(id, row);
            }
            derivedCapabilityCandidates = deriveCapabilitiesForScope(scopeIds, supportsEdges, elementsById);
          }
        }
        // B1: the estate query behind "how it might be met" — for each
        // capability in scope, the systems we run today that support it.
        const scopeCapabilities = scopeIds.flatMap((id) => {
          const el = elementsById.get(id);
          return el?.element_type === 'capability' ? [el] : [];
        });
        const journeyCapabilities: JourneyCapability[] = [];
        if (scopeCapabilities.length > 0 && main?.head_commit_id) {
          const edges = await listSupportsEdgesForCapabilities(supabase, main.head_commit_id, scopeCapabilities.map((c) => c.element_id));
          const supporterIds = [...new Set(edges.map((e) => e.from_element_id))];
          const supporters = supporterIds.length > 0 ? await getElementsByIds(supabase, main.head_commit_id, supporterIds) : new Map<UUID, ElementsHeadRow>();
          const now = new Date();
          for (const capability of scopeCapabilities) {
            const names = edges
              .filter((e) => e.to_element_id === capability.element_id)
              .flatMap((e) => {
                const supporter = supporters.get(e.from_element_id);
                return supporter && lifecycleStateOf(supporter, supporters, now) === 'active' ? [supporter.name] : [];
              });
            journeyCapabilities.push({ id: capability.element_id, name: capability.name, supporters: [...new Set(names)].sort() });
          }
        }
        if (isCancelled()) return;
        setState({ status: 'ready', data: { project, decisions, constrainingDecisions, changes, links, evidence, touched: [...touchedById.values()], reachedIds: [...reachedIds], elementsById, scopeHasCapability, derivedCapabilityCandidates, journeyCapabilities } });
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

