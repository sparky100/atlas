import { useEffect, useState } from 'react';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import {
  getElementHead,
  getElementsByIds,
  getSourcesByIds,
  listAliasesForElement,
  listChildrenOf,
  listDeltaHistoryForSubject,
  listFactsForSubject,
  listInFlightBranchesTouchingSubject,
  listRelationshipsForElement,
  type DeltaHistoryRow,
} from '../../db/elements';
import type { AliasRow, BranchRow, SourceRow } from '../../db/types';
import { refParamOf, resolveRef, type Ref } from '../../db/ref';
import { supabase } from '../supabaseClient';

export interface ElementPageData {
  commitId: UUID;
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  parent: ElementsHeadRow | null;
  children: ElementsHeadRow[];
  relationships: RelationshipsHeadRow[];
  /** The other endpoint of each relationship in `relationships` — never this element itself. */
  relationshipEndpoints: Map<UUID, ElementsHeadRow>;
  relationshipFacts: Map<UUID, Map<string, FactsRow>>;
  aliases: AliasRow[];
  aliasSources: Map<UUID, SourceRow>;
  sources: Map<UUID, SourceRow>;
  history: DeltaHistoryRow[];
  inFlightBranches: BranchRow[];
}

export type ElementPageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  /** The ref resolved to a real commit, but this element doesn't exist there — §2.4's "not present at this ref" state, not a 404. */
  | { status: 'notPresentAtRef'; commitId: UUID }
  | { status: 'refNotFound' }
  | { status: 'ready'; data: ElementPageData };

async function loadFacts(commitId: UUID, subjectId: UUID): Promise<Map<string, FactsRow>> {
  const rows = await listFactsForSubject(supabase, commitId, subjectId);
  return new Map(rows.map((row) => [row.attribute, row]));
}

export function useElementPage(modelId: UUID, elementId: UUID, ref: Ref): ElementPageState {
  const [state, setState] = useState<ElementPageState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      const commitId = await resolveRef(supabase, modelId, ref);
      if (!commitId) {
        if (!cancelled) setState({ status: 'refNotFound' });
        return;
      }

      const element = await getElementHead(supabase, commitId, elementId);
      if (!element) {
        if (!cancelled) setState({ status: 'notPresentAtRef', commitId });
        return;
      }

      const [facts, relationships, aliases, history, inFlightBranches] = await Promise.all([
        loadFacts(commitId, elementId),
        listRelationshipsForElement(supabase, commitId, elementId),
        listAliasesForElement(supabase, modelId, elementId),
        listDeltaHistoryForSubject(supabase, modelId, elementId),
        listInFlightBranchesTouchingSubject(supabase, modelId, elementId),
      ]);

      const parent = element.parent_id ? await getElementHead(supabase, commitId, element.parent_id) : null;
      const children = await listChildrenOf(supabase, commitId, elementId);

      const otherEndpointIds = relationships.map((rel) => (rel.from_element_id === elementId ? rel.to_element_id : rel.from_element_id));
      const [relationshipEndpoints, relationshipFactsList] = await Promise.all([
        getElementsByIds(supabase, commitId, otherEndpointIds),
        Promise.all(relationships.map((rel) => loadFacts(commitId, rel.relationship_id))),
      ]);
      const relationshipFacts = new Map(relationships.map((rel, i) => [rel.relationship_id, relationshipFactsList[i] ?? new Map<string, FactsRow>()]));

      const allSourceIds = [
        ...new Set([...facts.values()].map((f) => f.source_id).concat([...relationshipFactsList.flatMap((m) => [...m.values()].map((f) => f.source_id))])),
      ];
      const aliasSourceIds = [...new Set(aliases.map((a) => a.source_id))];
      const [sources, aliasSources] = await Promise.all([getSourcesByIds(supabase, allSourceIds), getSourcesByIds(supabase, aliasSourceIds)]);

      if (!cancelled) {
        setState({
          status: 'ready',
          data: { commitId, element, facts, parent, children, relationships, relationshipEndpoints, relationshipFacts, aliases, aliasSources, sources, history, inFlightBranches },
        });
      }
    }

    load().catch((e: unknown) => {
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load element' });
    });

    return () => {
      cancelled = true;
    };
    // `ref` is an object literal the caller typically constructs fresh each
    // render (e.g. from a URL query param) — depending on it directly would
    // re-run this effect, and re-fetch everything, on every render. Its
    // string form fully determines its meaning for this effect, so that's
    // the real dependency; `ref` itself is still read from the closure
    // (always the latest one, since the effect body re-runs whenever the
    // string does).
  }, [modelId, elementId, refParamOf(ref)]);

  return state;
}
