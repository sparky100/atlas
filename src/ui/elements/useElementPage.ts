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
  listFlowsViaElement,
  listInFlightBranchesTouchingSubject,
  listRelationshipsForElement,
  type DeltaHistoryRow,
} from '../../db/elements';
import {
  loadProjectionAtCommit,
  projectionChildrenOf,
  projectionElementById,
  projectionElementsByIds,
  projectionFactsForSubject,
  projectionFlowsViaElement,
  projectionRelationshipsForElement,
} from '../../db/branchProjection';
import type { HeadProjection } from '../../engine/projection';
import type { AliasRow, BranchRow, SourceRow } from '../../db/types';
import { refParamOf, resolveBranchRef, resolveRef, type Ref } from '../../db/ref';
import { capabilityLevel } from './capabilityDepth';
import { isIntegrationPlatform, isPlatform } from './systemKind';
import { supabase } from '../supabaseClient';

export interface ElementPageData {
  commitId: UUID;
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  parent: ElementsHeadRow | null;
  /** Capability only — computed, not a fact (see capabilityLevel's own comment). Always `undefined` for every other element type. */
  capabilityLevel: number | null | undefined;
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
  /** Prompt 7k item 4's "Flows via this platform" — every `uses`/`flows_to` edge naming this element as `via`, only ever populated when `element` is a system with `kind: 'integration_platform'` (`isIntegrationPlatform`); `[]` for every other element, not `undefined`, so the section can render an honest empty state rather than needing a second "is this even a platform" check downstream. */
  flowsViaThisPlatform: RelationshipsHeadRow[];
  /** The endpoints (`from`/`to`) of every edge in `flowsViaThisPlatform` — never this element itself, which is only ever the `via`, not an endpoint, of these edges. */
  flowsViaThisPlatformEndpoints: Map<UUID, ElementsHeadRow>;
  /**
   * "Platforms and modules": every live `supports` edge from one of this
   * element's own `children` (its modules) — only ever populated when
   * `element` is a system with `kind: 'platform'` (`isPlatform`); `[]` for
   * every other element, same honest-empty-state reasoning
   * `flowsViaThisPlatform` above already gives. Not populated for a system
   * that isn't itself a platform, even if it happens to have containers —
   * an ordinary system's own containers are shown in "Structure", not here.
   */
  moduleSupportsEdges: RelationshipsHeadRow[];
  /** Every capability named by a `moduleSupportsEdges` edge's own `toElementId` — what `ModulesSection.tsx` groups modules by. */
  moduleSupportsCapabilities: Map<UUID, ElementsHeadRow>;
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

/**
 * `getElementHead`/`listChildrenOf`/`listRelationshipsForElement`/
 * `listFactsForSubject`/`getElementsByIds` above all read
 * `elements_head`/`relationships_head`/`facts` by `commit_id` — rows that
 * SPEC §1 S-2 (P-6) only ever materialises for `main`'s current head and
 * tags, never a `change` branch's, at any point in its life. A branch ref
 * resolves fine here right up until the branch's own first real commit
 * (its head still equals whatever main commit it forked from, which *is*
 * materialised) — the instant it commits anything of its own, its new head
 * commit has zero rows in any of those tables, and every element on it
 * reads back as `notPresentAtRef`. `src/ui/landscape/useLandscape.ts` hit
 * this exact gap first (its own module comment) and fixed it by folding a
 * branch's head in memory via `src/db/branchProjection.ts` instead of
 * querying the materialised tables; this loader closes the same gap for
 * the element page (found via Sprint C1-H item 1's e2e diagnostics: a
 * real edit on a change branch left `✎ Edit` never reappearing, tracing
 * back not to a rejected commit or a swallowed error — the two suspects
 * named going in — but to the post-save reload landing on
 * `notPresentAtRef` for an element that plainly still exists). A `commit:`
 * ref (Sprint U4-1 B2's commit-diff view links) has the identical problem
 * for the identical reason — almost never main's current head — and gets
 * the same fix below.
 */
interface ElementSource {
  commitId: UUID;
  element: (elementId: UUID) => Promise<ElementsHeadRow | null>;
  elementsByIds: (ids: readonly UUID[]) => Promise<Map<UUID, ElementsHeadRow>>;
  children: (parentId: UUID) => Promise<ElementsHeadRow[]>;
  relationships: (elementId: UUID) => Promise<RelationshipsHeadRow[]>;
  facts: (subjectId: UUID) => Promise<Map<string, FactsRow>>;
  /** Prompt 7k item 4 — see `ElementPageData.flowsViaThisPlatform`'s own doc comment. */
  flowsViaElement: (platformElementId: UUID) => Promise<RelationshipsHeadRow[]>;
}

function projectionSource(commitId: UUID, projection: HeadProjection): ElementSource {
  return {
    commitId,
    element: (elementId) => Promise.resolve(projectionElementById(projection, elementId)),
    elementsByIds: (ids) => Promise.resolve(projectionElementsByIds(projection, ids)),
    children: (parentId) => Promise.resolve(projectionChildrenOf(projection, parentId)),
    relationships: (elementId) => Promise.resolve(projectionRelationshipsForElement(projection, elementId)),
    facts: (subjectId) => Promise.resolve(projectionFactsForSubject(projection, subjectId)),
    flowsViaElement: (platformElementId) => Promise.resolve(projectionFlowsViaElement(projection, platformElementId)),
  };
}

function commitSource(commitId: UUID): ElementSource {
  return {
    commitId,
    element: (elementId) => getElementHead(supabase, commitId, elementId),
    elementsByIds: (ids) => getElementsByIds(supabase, commitId, ids),
    children: (parentId) => listChildrenOf(supabase, commitId, parentId),
    relationships: (elementId) => listRelationshipsForElement(supabase, commitId, elementId),
    facts: (subjectId) => loadFacts(commitId, subjectId),
    flowsViaElement: (platformElementId) => listFlowsViaElement(supabase, commitId, platformElementId),
  };
}

/** `main`/`tag` read the materialised tables directly; a branch ref folds its head in memory (see the comment above `ElementSource`). */
async function resolveElementSource(modelId: UUID, ref: Ref): Promise<ElementSource | null> {
  if (ref.kind === 'branch') {
    const branch = await resolveBranchRef(supabase, ref);
    if (!branch) return null;
    const projection = await loadProjectionAtCommit(supabase, modelId, branch.head_commit_id);
    return projectionSource(branch.head_commit_id, projection);
  }
  if (ref.kind === 'commit') {
    // Same gap as a branch head (this file's own comment above `ElementSource`):
    // an arbitrary `commit:` ref (Sprint U4-1 B2's commit-diff links) is
    // essentially never main's *current* head, so `elements_head` has no
    // rows for it — fold it in memory instead, exactly like a branch head.
    const commitId = await resolveRef(supabase, modelId, ref);
    if (!commitId) return null;
    const projection = await loadProjectionAtCommit(supabase, modelId, commitId);
    return projectionSource(commitId, projection);
  }
  const commitId = await resolveRef(supabase, modelId, ref);
  if (!commitId) return null;
  return commitSource(commitId);
}

export interface UseElementPageResult {
  state: ElementPageState;
  /** Re-fetches everything at the current ref — used after a successful edit (Sprint U1 step 5) so the page shows the commit it just made, provenance and history included, rather than patching local state by hand. */
  reload: () => void;
}

export function useElementPage(modelId: UUID, elementId: UUID, ref: Ref): UseElementPageResult {
  const [state, setState] = useState<ElementPageState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      const source = await resolveElementSource(modelId, ref);
      if (!source) {
        if (!cancelled) setState({ status: 'refNotFound' });
        return;
      }
      const { commitId } = source;

      const element = await source.element(elementId);
      if (!element) {
        if (!cancelled) setState({ status: 'notPresentAtRef', commitId });
        return;
      }

      const [facts, relationships, aliases, history, inFlightBranches] = await Promise.all([
        source.facts(elementId),
        source.relationships(elementId),
        listAliasesForElement(supabase, modelId, elementId),
        listDeltaHistoryForSubject(supabase, modelId, elementId),
        listInFlightBranchesTouchingSubject(supabase, modelId, elementId),
      ]);

      const parent = element.parent_id ? await source.element(element.parent_id) : null;
      const children = await source.children(elementId);

      // Capability only, and only as deep as the level computation needs
      // (at most a grandparent — nesting is capped at 3 levels): a plain
      // structural value, not a fact, so it gets no badge and lives
      // outside `facts` entirely.
      let elementCapabilityLevel: number | null | undefined;
      if (element.element_type === 'capability') {
        const grandparent = parent?.parent_id ? await source.element(parent.parent_id) : null;
        elementCapabilityLevel = capabilityLevel(parent, grandparent);
      }

      const otherEndpointIds = relationships.map((rel) => (rel.from_element_id === elementId ? rel.to_element_id : rel.from_element_id));
      const [relationshipEndpoints, relationshipFactsList] = await Promise.all([
        source.elementsByIds(otherEndpointIds),
        Promise.all(relationships.map((rel) => source.facts(rel.relationship_id))),
      ]);
      const relationshipFacts = new Map(relationships.map((rel, i) => [rel.relationship_id, relationshipFactsList[i] ?? new Map<string, FactsRow>()]));

      const allSourceIds = [
        ...new Set([...facts.values()].map((f) => f.source_id).concat([...relationshipFactsList.flatMap((m) => [...m.values()].map((f) => f.source_id))])),
      ];
      const aliasSourceIds = [...new Set(aliases.map((a) => a.source_id))];
      const [sources, aliasSources] = await Promise.all([getSourcesByIds(supabase, allSourceIds), getSourcesByIds(supabase, aliasSourceIds)]);

      // Prompt 7k item 4: only a system with `kind: 'integration_platform'`
      // can ever be named as anyone's `via` — every other element type
      // skips this fetch entirely rather than paying for a commit-scoped
      // uses/flows_to scan it can never have a match in.
      let flowsViaThisPlatform: RelationshipsHeadRow[] = [];
      let flowsViaThisPlatformEndpoints = new Map<UUID, ElementsHeadRow>();
      if (element.element_type === 'system' && isIntegrationPlatform(element)) {
        flowsViaThisPlatform = await source.flowsViaElement(elementId);
        const endpointIds = flowsViaThisPlatform.flatMap((r) => [r.from_element_id, r.to_element_id]);
        flowsViaThisPlatformEndpoints = await source.elementsByIds(endpointIds);
      }

      // "Platforms and modules": a platform's own children (already loaded
      // above as `children`, no new round trip for that half) are its
      // modules — reuse the same `ElementSource.relationships` primitive
      // `PlatformFlowsSection`'s own data uses, once per module, to find
      // which capabilities they support.
      let moduleSupportsEdges: RelationshipsHeadRow[] = [];
      let moduleSupportsCapabilities = new Map<UUID, ElementsHeadRow>();
      if (element.element_type === 'system' && isPlatform(element) && children.length > 0) {
        const perModuleRelationships = await Promise.all(children.map((module) => source.relationships(module.element_id)));
        moduleSupportsEdges = perModuleRelationships.flat().filter((rel) => rel.relationship_type === 'supports');
        const capabilityIds = [...new Set(moduleSupportsEdges.map((rel) => rel.to_element_id))];
        moduleSupportsCapabilities = await source.elementsByIds(capabilityIds);
      }

      if (!cancelled) {
        setState({
          status: 'ready',
          data: {
            commitId,
            element,
            facts,
            parent,
            capabilityLevel: elementCapabilityLevel,
            children,
            relationships,
            relationshipEndpoints,
            relationshipFacts,
            aliases,
            aliasSources,
            sources,
            history,
            inFlightBranches,
            flowsViaThisPlatform,
            flowsViaThisPlatformEndpoints,
            moduleSupportsEdges,
            moduleSupportsCapabilities,
          },
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
  }, [modelId, elementId, refParamOf(ref), reloadToken]);

  return {
    state,
    reload: () => {
      setReloadToken((t) => t + 1);
    },
  };
}
