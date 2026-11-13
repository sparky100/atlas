import { useEffect, useState } from 'react';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import {
  getElementHead,
  getElementNamesByIds,
  getElementsByIds,
  getSourcesByIds,
  listAliasesForElement,
  listChildrenOf,
  listDeltaHistoryForSubject,
  listFactsForSubject,
  listFactsForSubjects,
  listFlowsViaElement,
  listInFlightBranchesTouchingSubject,
  listRelationshipHistoryForElement,
  listRelationshipsForElement,
  type DeltaHistoryRow,
} from '../../db/elements';
import { listBranchesByIds } from '../../db/branches';
import { listDecisionLinksForDecision, listDecisionsLinkingElements } from '../../db/decisions';
import { buildRelationshipParticipantsById } from '../components/HistoryTimeline/historyTimelineSummary';
import {
  projectionChildrenOf,
  projectionElementById,
  projectionElementsByIds,
  projectionFactsForSubject,
  projectionFlowsViaElement,
  projectionRelationshipsForElement,
} from '../../db/branchProjection';
import type { HeadProjection } from '../../engine/projection';
import type { AliasRow, BranchRow, DecisionRow, SourceRow } from '../../db/types';
import { refParamOf, resolveBranchRef, resolveRef, type Ref } from '../../db/ref';
import { loadProjectionAtCommitCached } from '../query/cachedBranchProjection';
import { attributesRecord } from './attributesRecord';
import { capabilityLevel } from './capabilityDepth';
import { containerParentIds, valueStreamParentIds } from './moduleDisplayName';
import { flowViaIdsFor, isPlatform } from './systemKind';
import { reportError } from '../errors/errorBannerStore';
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
  /** The other endpoint of each relationship in `relationships` — never this element itself. Also covers every *live* endpoint `history`'s own relationship entries can name, since retracted included (`HistoryTimeline.tsx`'s own `relationshipEndpoints` prop) — a superset, not a second map, since a `relationships`-only entry is a strict subset of everything `history` can ever reference. An endpoint that has itself since been retracted (no longer a live element at all, not just no longer connected) is never in here — see `retractedElementNames`. */
  relationshipEndpoints: Map<UUID, ElementsHeadRow>;
  /** `historyEndpointIds` minus whatever `relationshipEndpoints` above already resolved — an element `elements_head`/a branch projection can never answer for (it's been retracted, so neither knows it), read instead from its own permanent `deltas` (`getElementNamesByIds`'s own doc comment). `HistoryTimeline.tsx`'s last-resort name source, before its own raw-id fallback. */
  retractedElementNames: Map<UUID, string>;
  relationshipFacts: Map<UUID, Map<string, FactsRow>>;
  aliases: AliasRow[];
  aliasSources: Map<UUID, SourceRow>;
  sources: Map<UUID, SourceRow>;
  /**
   * "Relationship removal": this element's own deltas
   * (`listDeltaHistoryForSubject(elementId)`) merged with every delta ever
   * asserted about a relationship that has touched this element on either
   * side, live or since retracted (`listRelationshipHistoryForElement`) —
   * one combined, re-sorted timeline. Closes the gap `HistoryTimeline.tsx`'s
   * own already-ready `relationship_create`/`update`/`retract`/`restore`
   * rendering cases had nothing feeding them before this.
   */
  history: DeltaHistoryRow[];
  inFlightBranches: BranchRow[];
  /**
   * The page shows its element, facts, relationships, modules and flows as soon as those arrive; history, in-flight
   * changes and decisions (the three lower-right sections, which nothing above depends on) load straight after and
   * fill in `history`, `inFlightBranches`, `elementDecisions`, `retractedElementNames` and any history-only
   * endpoints in `relationshipEndpoints`. Until `'ready'` those hold empty placeholders — a section must show
   * "loading" (or the error), never render the empty value as if it were the answer.
   */
  secondary: 'loading' | 'ready' | 'error';
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
  /**
   * "Why is this here" (prompt pack F3 PR6): every decision that names
   * this element — or, for a capability, one of its own capability
   * ancestors — as something it concerns, newest first, each with every
   * branch-linked option it has (the chosen one and any cancelled
   * "losing" ones alike, for a decision that's already `accepted`; every
   * option is still `draft` for one that isn't). Decisions are model-wide,
   * never branch/ref-scoped (same reasoning `useDecision.ts` already
   * gives), so this is read the same regardless of the page's own `ref`.
   */
  elementDecisions: ElementPageDecisionEntry[];
}

export interface ElementPageDecisionEntry {
  decision: DecisionRow;
  options: BranchRow[];
}

export type ElementPageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  /** The ref resolved to a real commit, but this element doesn't exist there — §2.4's "not present at this ref" state, not a 404. */
  /** `elementId`: which element this was decided for — the page stays mounted when it moves to another element (a merge or conversion lands on the survivor), so a reader checks this before acting on a state left over from the previous one. */
  | { status: 'notPresentAtRef'; commitId: UUID; elementId: UUID }
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
  /** Every subject's facts in one go — the element page's relationship facts (`listFactsForSubjects`). */
  factsForSubjects: (subjectIds: readonly UUID[]) => Promise<Map<UUID, Map<string, FactsRow>>>;
  /** Prompt 7k item 4 — see `ElementPageData.flowsViaThisPlatform`'s own doc comment. */
  flowsViaElement: (viaIds: readonly UUID[]) => Promise<RelationshipsHeadRow[]>;
}

function projectionSource(commitId: UUID, projection: HeadProjection): ElementSource {
  return {
    commitId,
    element: (elementId) => Promise.resolve(projectionElementById(projection, elementId)),
    elementsByIds: (ids) => Promise.resolve(projectionElementsByIds(projection, ids)),
    children: (parentId) => Promise.resolve(projectionChildrenOf(projection, parentId)),
    relationships: (elementId) => Promise.resolve(projectionRelationshipsForElement(projection, elementId)),
    facts: (subjectId) => Promise.resolve(projectionFactsForSubject(projection, subjectId)),
    factsForSubjects: (subjectIds) => Promise.resolve(new Map(subjectIds.map((id) => [id, projectionFactsForSubject(projection, id)]))),
    flowsViaElement: (viaIds) => Promise.resolve(projectionFlowsViaElement(projection, viaIds)),
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
    factsForSubjects: (subjectIds) => listFactsForSubjects(supabase, commitId, subjectIds),
    flowsViaElement: (viaIds) => listFlowsViaElement(supabase, commitId, viaIds),
  };
}

/**
 * `main`/`tag` read the materialised tables directly; a branch ref folds
 * its head in memory (see the comment above `ElementSource`).
 * `mainCommitIdHint` (S1 item 15, A2 remainder): the caller's own
 * already-resolved main head commit id, used only for `ref.kind === 'main'`
 * — `resolveRef`'s own round trip is skipped in exactly that case.
 */
async function resolveElementSource(modelId: UUID, ref: Ref, mainCommitIdHint: UUID | null): Promise<ElementSource | null> {
  if (ref.kind === 'branch') {
    const branch = await resolveBranchRef(supabase, ref);
    if (!branch) return null;
    const projection = await loadProjectionAtCommitCached(supabase, modelId, branch.head_commit_id);
    return projectionSource(branch.head_commit_id, projection);
  }
  if (ref.kind === 'commit') {
    // Same gap as a branch head (this file's own comment above `ElementSource`):
    // an arbitrary `commit:` ref (Sprint U4-1 B2's commit-diff links) is
    // essentially never main's *current* head, so `elements_head` has no
    // rows for it — fold it in memory instead, exactly like a branch head.
    const commitId = await resolveRef(supabase, modelId, ref);
    if (!commitId) return null;
    const projection = await loadProjectionAtCommitCached(supabase, modelId, commitId);
    return projectionSource(commitId, projection);
  }
  const commitId = ref.kind === 'main' && mainCommitIdHint ? mainCommitIdHint : await resolveRef(supabase, modelId, ref);
  if (!commitId) return null;
  return commitSource(commitId);
}

export interface UseElementPageResult {
  state: ElementPageState;
  /** Re-fetches everything at the current ref — used after a successful edit (Sprint U1 step 5) so the page shows the commit it just made, provenance and history included, rather than patching local state by hand. */
  reload: () => void;
}

export function useElementPage(
  modelId: UUID,
  elementId: UUID,
  ref: Ref,
  /** S1 item 15 (A2 remainder): the caller's own already-resolved main head commit id — `resolveElementSource`'s own parameter comment. */
  mainCommitIdHint: UUID | null = null,
): UseElementPageResult {
  const [state, setState] = useState<ElementPageState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // S1 item 15: guard on `modelId`/`elementId` before firing, matching
    // `useBreadcrumbElement.ts`'s own established fix for the identical
    // shape — most callers pass `model?.id ?? ''` before their own model
    // resolves, and without this guard the effect fires once against an
    // empty modelId, throws, and (now that this hook's catch also calls
    // `reportError`) leaves a misleading "Couldn't load this element."
    // banner up even after the very next render loads it successfully.
    if (!modelId || !elementId) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      const source = await resolveElementSource(modelId, ref, mainCommitIdHint);
      if (!source) {
        if (!cancelled) setState({ status: 'refNotFound' });
        return;
      }
      const { commitId } = source;

      // Performance: every request that needs only `elementId` goes out
      // together with the element itself — the page used to wait for the
      // element row before asking for anything else, then for the parent
      // before the children, and so on, one round trip at a time.
      // History and in-flight changes feed only the lower-right sections, so they start after the page body has been shown (see below), not alongside it.
      const [element, facts, relationships, aliases, children] = await Promise.all([source.element(elementId), source.facts(elementId), source.relationships(elementId), listAliasesForElement(supabase, modelId, elementId), source.children(elementId)]);
      if (!element) {
        if (!cancelled) setState({ status: 'notPresentAtRef', commitId, elementId });
        return;
      }

      const parent = element.parent_id ? await source.element(element.parent_id) : null;

      // Capability only, and only as deep as the level computation needs
      // (at most a grandparent — nesting is capped at 3 levels): a plain
      // structural value, not a fact, so it gets no badge and lives
      // outside `facts` entirely. `grandparent` is also "why is this
      // here"'s own capability-ancestor chain below, not refetched there.
      let elementCapabilityLevel: number | null | undefined;
      let grandparent: ElementsHeadRow | null = null;
      if (element.element_type === 'capability') {
        grandparent = parent?.parent_id ? await source.element(parent.parent_id) : null;
        elementCapabilityLevel = capabilityLevel(parent, grandparent);
      }

      // "Why is this here" (prompt pack F3 PR6): this element itself, plus
      // — only for a capability — its own capability ancestors (`parent`/
      // `grandparent` above), a chain capped at 2 extra ids by SPEC's own
      // L1/L2/L3 nesting ceiling, never a list that grows with model size.
      const decisionElementIds: UUID[] = [elementId];
      if (element.element_type === 'capability') {
        if (parent) decisionElementIds.push(parent.element_id);
        if (grandparent) decisionElementIds.push(grandparent.element_id);
      }
      const loadDecisions = async (): Promise<ElementPageDecisionEntry[]> => {
        const decisionLinks = await listDecisionsLinkingElements(supabase, decisionElementIds);
        const decisionsById = new Map<UUID, DecisionRow>();
        for (const link of decisionLinks) decisionsById.set(link.decision.id, link.decision);
        return Promise.all(
          [...decisionsById.values()]
            .sort((a, b) => (a.created_at === b.created_at ? 0 : a.created_at < b.created_at ? 1 : -1))
            .map(async (decision) => {
              const allLinks = await listDecisionLinksForDecision(supabase, decision.id);
              const branchIds = allLinks.filter((l) => l.linked_type === 'branch').map((l) => l.linked_id);
              const options = branchIds.length > 0 ? await listBranchesByIds(supabase, branchIds) : [];
              return { decision, options };
            }),
        );
      };

      // Relationship attribute editing, general: the expanded attributes
      // panel shows `uses`/`flows_to`'s own `via` resolved to a name and
      // linked, the same as any other endpoint — so `via` ids are folded into
      // the same batch lookup as the ordinary from/to endpoints. History's
      // own need is folded in too: `HistoryTimeline.tsx` names the *other*
      // side of a relationship, live or since retracted, recovered from each
      // relationship's own `relationship_create` row
      // (`buildRelationshipParticipantsById`).
      const liveEndpointIds = relationships.flatMap((rel) => {
        const attrs = attributesRecord(rel.attributes);
        const viaId = typeof attrs.via === 'string' ? [attrs.via] : [];
        return [rel.from_element_id === elementId ? rel.to_element_id : rel.from_element_id, ...viaId];
      });

      /** `endpoints` plus the parent platform of any module and parent stream of any stage in it (for "Platform · Module" / "Stream · Stage"). A parent is never itself an endpoint, so it is fetched alongside and folded into the same map. */
      const withParents = async (endpoints: Map<UUID, ElementsHeadRow>): Promise<Map<UUID, ElementsHeadRow>> => {
        const parentIds = [...new Set([...containerParentIds(endpoints.values()), ...valueStreamParentIds(endpoints.values())])].filter((id) => !endpoints.has(id));
        if (parentIds.length === 0) return endpoints;
        const parents = await source.elementsByIds(parentIds);
        return new Map([...endpoints, ...parents]);
      };

      const loadLiveEndpoints = async (): Promise<Map<UUID, ElementsHeadRow>> => withParents(await source.elementsByIds(liveEndpointIds));

      // Second stage, once history is in: history's own extra endpoints (relationships since retracted), and the
      // names of any that have themselves been retracted outright (`getElementNamesByIds`, read from `deltas`).
      const loadHistoryEndpoints = async (
        liveEndpoints: Map<UUID, ElementsHeadRow>,
        history: DeltaHistoryRow[],
      ): Promise<{ relationshipEndpoints: Map<UUID, ElementsHeadRow>; retractedElementNames: Map<UUID, string> }> => {
        const historyEndpointIds = [...buildRelationshipParticipantsById(history).values()].flatMap((p) => [p.fromElementId, p.toElementId]);
        const extraHistoryIds = [...new Set(historyEndpointIds)].filter((id) => !liveEndpoints.has(id));
        const extras = extraHistoryIds.length > 0 ? await source.elementsByIds(extraHistoryIds) : new Map<UUID, ElementsHeadRow>();
        const relationshipEndpoints = await withParents(new Map([...liveEndpoints, ...extras]));
        const missingHistoryElementIds = [...new Set(historyEndpointIds)].filter((id) => !relationshipEndpoints.has(id));
        const retractedElementNames = await getElementNamesByIds(supabase, modelId, missingHistoryElementIds);
        return { relationshipEndpoints, retractedElementNames };
      };

      const loadFactsAndSources = async (): Promise<{ relationshipFacts: Map<UUID, Map<string, FactsRow>>; sources: Map<UUID, SourceRow>; aliasSources: Map<UUID, SourceRow> }> => {
        // One request for every relationship's facts, not one each.
        const relationshipFacts = await source.factsForSubjects(relationships.map((rel) => rel.relationship_id));
        const allSourceIds = [...new Set([...facts.values()].map((f) => f.source_id).concat([...relationshipFacts.values()].flatMap((m) => [...m.values()].map((f) => f.source_id))))];
        const aliasSourceIds = [...new Set(aliases.map((a) => a.source_id))];
        const [sources, aliasSources] = await Promise.all([getSourcesByIds(supabase, allSourceIds), getSourcesByIds(supabase, aliasSourceIds)]);
        return { relationshipFacts, sources, aliasSources };
      };

      // Prompt 7k item 4: only an integration platform (or, ADR-026, one of
      // its interfaces) can ever be named as anyone's `via` — every other
      // element skips this fetch entirely. A flow's own source/target can be
      // a module of some other platform, so its parent is folded in too.
      const loadFlowsVia = async (): Promise<{ flows: RelationshipsHeadRow[]; endpoints: Map<UUID, ElementsHeadRow> }> => {
        const viaIds = flowViaIdsFor(element, parent, children);
        if (viaIds.length === 0) return { flows: [], endpoints: new Map() };
        const flows = await source.flowsViaElement(viaIds);
        const endpoints = await source.elementsByIds(flows.flatMap((r) => [r.from_element_id, r.to_element_id]));
        const flowEndpointParentIds = containerParentIds(endpoints.values());
        if (flowEndpointParentIds.length > 0) {
          const parents = await source.elementsByIds(flowEndpointParentIds);
          for (const [id, row] of parents) endpoints.set(id, row);
        }
        return { flows, endpoints };
      };

      // "Platforms and modules": a platform's own children are its modules —
      // which capabilities they support, once per module.
      const loadModuleSupports = async (): Promise<{ edges: RelationshipsHeadRow[]; capabilities: Map<UUID, ElementsHeadRow> }> => {
        if (element.element_type !== 'system' || !isPlatform(element) || children.length === 0) return { edges: [], capabilities: new Map() };
        const perModuleRelationships = await Promise.all(children.map((module) => source.relationships(module.element_id)));
        const edges = perModuleRelationships.flat().filter((rel) => rel.relationship_type === 'supports');
        const capabilities = await source.elementsByIds([...new Set(edges.map((rel) => rel.to_element_id))]);
        return { edges, capabilities };
      };

      // Performance: the page body needs only these four, and they are independent of each other, so they run together.
      const [liveEndpoints, { relationshipFacts, sources, aliasSources }, flowsVia, moduleSupports] = await Promise.all([
        loadLiveEndpoints(),
        loadFactsAndSources(),
        loadFlowsVia(),
        loadModuleSupports(),
      ]);
      if (cancelled) return;

      // The lower-right sections load next, without holding the body back (see `ElementPageData.secondary`).
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
          relationshipEndpoints: liveEndpoints,
          retractedElementNames: new Map(),
          relationshipFacts,
          aliases,
          aliasSources,
          sources,
          history: [],
          inFlightBranches: [],
          flowsViaThisPlatform: flowsVia.flows,
          flowsViaThisPlatformEndpoints: flowsVia.endpoints,
          moduleSupportsEdges: moduleSupports.edges,
          moduleSupportsCapabilities: moduleSupports.capabilities,
          elementDecisions: [],
          secondary: 'loading',
        },
      });

      const applySecondary = (patch: Partial<ElementPageData>) => {
        if (cancelled) return;
        setState((prev) => (prev.status === 'ready' && prev.data.commitId === commitId && prev.data.element.element_id === elementId ? { status: 'ready', data: { ...prev.data, ...patch } } : prev));
      };
      try {
        // Merge, then re-sort — `listDeltaHistoryForSubject`'s own newest-first,
        // `id`-tiebreak order (see that function's doc comment) applied across
        // both sources together, not just within each.
        const historyPromise = Promise.all([listDeltaHistoryForSubject(supabase, modelId, elementId), listRelationshipHistoryForElement(supabase, modelId, elementId)]).then(([ownHistory, relationshipHistory]) =>
          [...ownHistory, ...relationshipHistory].sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : b.created_at.localeCompare(a.created_at))),
        );
        const [elementDecisions, history, inFlightBranches] = await Promise.all([loadDecisions(), historyPromise, listInFlightBranchesTouchingSubject(supabase, modelId, elementId)]);
        const { relationshipEndpoints, retractedElementNames } = await loadHistoryEndpoints(liveEndpoints, history);
        applySecondary({ elementDecisions, history, inFlightBranches, relationshipEndpoints, retractedElementNames, secondary: 'ready' });
      } catch (e: unknown) {
        reportError("Couldn't load this element's history, changes and decisions.", e);
        applySecondary({ secondary: 'error' });
      }
    }

    load().catch((e: unknown) => {
      reportError("Couldn't load this element.", e);
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
  }, [modelId, elementId, refParamOf(ref), reloadToken, mainCommitIdHint]);

  return {
    state,
    reload: () => {
      setReloadToken((t) => t + 1);
    },
  };
}
