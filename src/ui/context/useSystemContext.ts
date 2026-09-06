import { useState, useEffect } from 'react';
import type { UUID } from '../../contracts/delta';
import { getElementHead, getElementsByIds, listRelationshipsForElement } from '../../db/elements';
import { refParamOf, resolveRef, type Ref } from '../../db/ref';
import { getOrCreateScopedView } from '../../db/views';
import type { ViewRow } from '../../db/types';
import { computeContextGroup, type ContextGroup } from './contextGrouping';
import { supabase } from '../supabaseClient';

export interface SystemContextData {
  commitId: UUID;
  view: ViewRow;
  group: ContextGroup;
}

export type SystemContextState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'refNotFound' }
  /** The ref resolved, but `systemId` isn't a System there (retracted, wrong id, or not a System at all) — §2.4's "not present at this ref", not a 404. */
  | { status: 'notPresentAtRef' }
  | { status: 'ready'; data: SystemContextData };

/**
 * Loads the Context view (UI-principles §6.1): the given system, every
 * system/actor it has a relationship with, grouped by
 * src/ui/context/contextGrouping.ts. No `view_layouts` — like the
 * capability map (and for the same reason: DOM/CSS grouping, not pixel
 * placement — see ContextView.tsx's module comment), there is no computed
 * position to persist or reset.
 */
export function useSystemContext(modelId: UUID, orgId: UUID, userId: UUID | null, systemId: UUID, ref: Ref): SystemContextState {
  const [state, setState] = useState<SystemContextState>({ status: 'loading' });
  const refParam = refParamOf(ref);

  useEffect(() => {
    if (!userId) return undefined;
    const currentUserId = userId;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      const commitId = await resolveRef(supabase, modelId, ref);
      if (!commitId) {
        if (!cancelled) setState({ status: 'refNotFound' });
        return;
      }

      const hub = await getElementHead(supabase, commitId, systemId);
      if (hub?.element_type !== 'system') {
        if (!cancelled) setState({ status: 'notPresentAtRef' });
        return;
      }

      const relationships = await listRelationshipsForElement(supabase, commitId, systemId);
      const otherIds = [...new Set(relationships.map((r) => (r.from_element_id === systemId ? r.to_element_id : r.from_element_id)))];
      const elementsById = await getElementsByIds(supabase, commitId, otherIds);

      const view = await getOrCreateScopedView(supabase, { id: crypto.randomUUID(), orgId, modelId, kind: 'context', name: `Context: ${hub.name}`, scopeElementId: systemId, createdBy: currentUserId });
      const group = computeContextGroup(hub, relationships, elementsById);

      if (!cancelled) setState({ status: 'ready', data: { commitId, view, group } });
    }

    load().catch((e: unknown) => {
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load this system’s context' });
    });

    return () => {
      cancelled = true;
    };
    // Same `refParam` pitfall/fix as every other view hook here.
  }, [modelId, orgId, userId, systemId, refParam]);

  return state;
}
