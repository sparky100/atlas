import { useEffect, useMemo, useState } from 'react';
import type { Criticality, ElementType, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, Json, RelationshipsHeadRow } from '../../contracts/rows';
import { CRITICALITY_ORDER } from './criticalityTone';
import { DISPOSITION_ORDER } from './disposition';
import type { Disposition } from '../../contracts/delta';
import { aiRankOf, isAiAgent, usesAi } from '../../engine/elementRead/aiAgent';
import { listAllElements, ownersByElementIdFromOwnsEdges, type BrowseRow } from '../../db/elementBrowse';
import { useStaleAfterMonths } from '../orgs/staleThresholdContext';
import { attributesRecord } from './attributesRecord';
import { buildBrowseRows } from './buildBrowseRows';
import { compareCustomAttributeValues, sortKeyEquals, type ElementBrowseSortKey } from './elementBrowseSort';
import { moduleDisplayName } from './moduleDisplayName';
import {
  computeStaleAttributesFinding,
  findCapabilitiesWithNoSupporters,
  findOutgoingWithoutRetiringChange,
  loadElementsRetiredByOpenChanges,
  findCapabilitiesWithoutOwner,
  findCriticalExposedSystems,
  findCriticalSystemsPastOrNearSupportEnd,
  findAiAgentsActingAloneWithoutTechnicalOwner,
  findCriticalSystemsWithoutBusinessOwner,
  findPlatformSupportsThatShouldMoveToModule,
  findSystemsSupportingEssentialFunctionWithoutTechnicalOwner,
  findSystemsWithoutCapability,
  findSystemsWithoutTechnicalOwner,
  findUnusedIntegrationInterfaces,
  findUnusedIntegrationPlatforms,
  listAllOwnsEdges,
  listAllReplacesEdges,
  listAllUsesAndFlowsToEdges,
  listFactStalenessForCommit,
  type FactStalenessRow,
} from '../../db/healthFindings';
import { replacedElementIds } from '../../engine/elementRead/fitAndExposure';
import { findLifecycleDateMismatches } from '../../engine/elementRead/lifecycleDateMismatch';
import { listAllSupportsEdges } from '../../db/modelHome';
import { computeCapabilityMapTree } from '../capabilityMap/layout';
import { refParamOf, resolveBranchRef, resolveRef, type Ref } from '../../db/ref';
import type { ViewMode } from '../../db/viewMode';
import { resolveBranchModeProjectionCached } from '../query/cachedBranchProjection';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

/** Everything one model load produced — filters read this, never the network again (see the first effect in `useElementBrowse`). */
interface BrowseBase {
  elements: ElementsHeadRow[];
  supportsEdges: RelationshipsHeadRow[];
  ownsEdges: RelationshipsHeadRow[];
  rows: BrowseRow[];
  commitId: UUID;
  getFacts: () => Promise<FactStalenessRow[]>;
  getUsesAndFlowsToEdges: () => Promise<RelationshipsHeadRow[]>;
  getReplacesEdges: () => Promise<RelationshipsHeadRow[]>;
  getRetiredByOpenChanges: () => Promise<Set<UUID>>;
}

/** Runs `fn` on first call and hands every later caller the same promise; a failure is forgotten so a retry can run again. */
function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => {
    cached ??= fn().catch((e: unknown) => {
      cached = null;
      throw e;
    });
    return cached;
  };
}

export type ElementBrowseStatus = 'loading' | 'error' | 'refNotFound' | 'ready';
// `ElementBrowseSortKey`/`sortKeyEquals`/`compareCustomAttributeValues` now
// live in `./elementBrowseSort` (see that file's own module comment for
// why) — re-exported here so every existing import site (`ElementsPage.tsx`,
// `ElementBrowseTable.tsx`) is unaffected.
export type { ElementBrowseSortKey } from './elementBrowseSort';
export { sortKeyEquals } from './elementBrowseSort';

/**
 * Sprint U4-1 B3: the "pre-filtered to the finding" links the architect
 * door's Health findings panel offers (`ArchitectHome.tsx`'s own
 * `browseHref`), read from the page's own `?filter=` param
 * (`ElementsPage.tsx`). `null` is the ordinary, unfiltered browse table.
 * Prompt 7k item 2 adds `no-technical-owner`; item 1 adds
 * `critical-no-business-owner` and `critical-exposed`; item 4 adds
 * `unused-integration-platform`; item 5 adds `essential-no-technical-owner`
 * and `critical-support-end`; S1 item 19 adds `platform-supports-move-to-module`.
 */
/** F1 PR4: `{ custom, value }` filters to elements whose own `attributes[custom] === value` — an org-defined attribute's own equality filter, `value` already parsed to the definition's own `kind` by the caller (`ElementsPage.tsx`'s `parseCustomFilterValue`), never a raw string here. One generic variant rather than a fixed literal per attribute (decision 6), same shape `ElementBrowseSortKey`'s own `{ custom }` variant uses. */
export interface CustomAttributeBrowseFilter {
  custom: string;
  value: Json;
}

export type ElementBrowseFilter =
  | 'unlinked-systems'
  | 'platform-supports-move-to-module'
  | 'unowned-capabilities'
  | 'stale-attributes'
  | 'no-technical-owner'
  | 'ai-agent-no-technical-owner'
  /** Every system marked as an AI agent, however freely it acts. Not a finding: a plain "show me the agents" filter. */
  | 'ai-agents'
  /** Every system that uses AI: an agent, or one with built-in AI features or an AI model or service recorded. Also a plain filter, not a finding. */
  | 'uses-ai'
  | 'critical-no-business-owner'
  | 'critical-exposed'
  | 'unused-integration-platform'
  /** ADR-026: interfaces on an integration platform nothing flows via (`findUnusedIntegrationInterfaces`). */
  | 'unused-integration-interface'
  | 'essential-no-technical-owner'
  | 'critical-support-end'
  /** Per-item-actions prompt: the third decision-shaped finding, `findCapabilitiesWithNoSupporters`'s own filter key (`ArchitectHome.tsx`'s `capability-no-supporters` check). */
  | 'capability-no-supporters'
  /** F11: systems and modules marked Migrate or Eliminate with no open change retiring them (`findOutgoingWithoutRetiringChange`). */
  | 'outgoing-no-retiring-change'
  /** Systems and modules whose lifecycle status and own dates disagree (`findLifecycleDateMismatches`). */
  | 'lifecycle-date-mismatch'
  | CustomAttributeBrowseFilter
  | null;

/** F11: the browse table's disposition filter — one value, or systems and modules with none recorded. */
export type DispositionFilter = 'all' | Disposition | 'not_assessed';

/** `not_assessed` matches only systems and containers (the types that carry the attribute) with nothing recorded. */
export function matchesDispositionFilter(row: Pick<BrowseRow, 'element' | 'disposition'>, filter: DispositionFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'not_assessed') return (row.element.element_type === 'system' || row.element.element_type === 'container') && row.disposition === null;
  return row.disposition === filter;
}

export type ElementBrowseState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'refNotFound' }
  | {
      status: 'ready';
      rows: BrowseRow[];
      completenessById: CompletenessById | null;
      typeFilter: ElementType | 'all';
      setTypeFilter: (type: ElementType | 'all') => void;
      /** F11: narrow to one disposition, or to systems/modules not yet assessed. */
      dispositionFilter: DispositionFilter;
      setDispositionFilter: (value: DispositionFilter) => void;
      query: string;
      setQuery: (query: string) => void;
      sortKey: ElementBrowseSortKey;
      sortDirection: 'asc' | 'desc';
      setSort: (key: ElementBrowseSortKey) => void;
      /** The commit every row was read at — `RelationshipAdd`'s own search needs this, for the inline supports picker on an unlinked-systems row. */
      commitId: UUID;
      /** F14: puts the page's own sort/filter controls into a saved report's state in one go. */
      restore: (next: { typeFilter: ElementType | 'all'; dispositionFilter: DispositionFilter; query: string; sortKey: ElementBrowseSortKey; sortDirection: 'asc' | 'desc' }) => void;
      /** Re-fetches everything (same `reload`-by-token shape `useMainBranch.ts` uses) — the inline supports picker's own `onCreated` calls this, so a just-linked system drops out of the `unlinked-systems` filter immediately rather than staying visible (and re-addable) until the next full page load. */
      reload: () => void;
    };

// Sorted (and, for 'name', compared) by `moduleDisplayName`, not the bare
// `element.name` — the table shows "SAP · RE", so it sorts under "S" too,
// the same "what you see is what you sorted by" guarantee
// `landscapeModules.ts`'s `withModuleLabels` already gets for free by
// overwriting `.name` outright before its own caller sorts.
function displayName(row: BrowseRow): string {
  return moduleDisplayName(row.element, row.parent);
}

/** "4 of 6 recorded" per element, for the Completeness column; absent for elements with no key facts. */
export type CompletenessById = ReadonlyMap<UUID, { recorded: number; total: number }>;

/** Least complete first; an element with no key facts (a capability, a retired system) sorts last. */
function completenessRankOf(row: BrowseRow, byId: CompletenessById | null): number {
  const c = byId?.get(row.element.element_id);
  return c && c.total > 0 ? c.recorded / c.total : 2;
}

function compareRows(a: BrowseRow, b: BrowseRow, key: ElementBrowseSortKey, completenessById: CompletenessById | null): number {
  if (typeof key === 'object') {
    return compareCustomAttributeValues(attributesRecord(a.element.attributes)[key.custom], attributesRecord(b.element.attributes)[key.custom]) || displayName(a).localeCompare(displayName(b));
  }
  switch (key) {
    case 'name':
      return displayName(a).localeCompare(displayName(b));
    case 'type':
      return a.element.element_type.localeCompare(b.element.element_type) || displayName(a).localeCompare(displayName(b));
    case 'owner':
      return (a.owner?.name ?? '').localeCompare(b.owner?.name ?? '') || displayName(a).localeCompare(displayName(b));
    case 'lifecycle':
      return (a.lifecycleStatus ?? '').localeCompare(b.lifecycleStatus ?? '') || displayName(a).localeCompare(displayName(b));
    case 'criticality':
      return criticalityOrderOf(a.criticality) - criticalityOrderOf(b.criticality) || displayName(a).localeCompare(displayName(b));
    case 'aiAutonomy':
      // No AI first, then built-in AI, an AI service, then agents from suggests only to acts alone.
      return aiRankOf(a.element) - aiRankOf(b.element) || displayName(a).localeCompare(displayName(b));
    case 'completeness':
      return completenessRankOf(a, completenessById) - completenessRankOf(b, completenessById) || displayName(a).localeCompare(displayName(b));
    case 'disposition':
      // Unset first, then best → worst (invest, tolerate, migrate, eliminate) — the same "unset sorts first" convention as criticality.
      return dispositionRankOf(a.disposition) - dispositionRankOf(b.disposition) || displayName(a).localeCompare(displayName(b));
  }
}

function dispositionRankOf(value: Disposition | null): number {
  return value === null ? -1 : DISPOSITION_ORDER.indexOf(value);
}

/** A missing or unrecognised criticality sorts before every recognised value — same "unset sorts first" convention `?? ''` already gives `owner`/`lifecycle` above. */
function criticalityOrderOf(value: string | null): number {
  return value !== null && value in CRITICALITY_ORDER ? CRITICALITY_ORDER[value as Criticality] : -1;
}

/**
 * The element browse table (Sprint U3b): every element of the model at
 * `main`'s head, filterable by type and a name search, sortable by any
 * column — all client-side over one already-loaded set (this module's own
 * comment in src/db/elementBrowse.ts explains why that's the right shape
 * here, not a live query per filter/sort change). Sprint U4-1 B3 adds
 * `filter`, applied the same way — computed once against the loaded set,
 * not a live query — using the exact same derivations the Health findings
 * panel itself uses (`src/db/healthFindings.ts`'s `findSystemsWithoutCapability`/
 * `findCapabilitiesWithoutOwner`/`computeStaleAttributesFinding`), so
 * "pre-filtered to the finding" means the identical definition, not a
 * second, driftable one. `supports`/`owns` edges are always fetched now
 * (cheap, commit-scoped bulk reads, same shape `listAllElements` already
 * is) — `facts` (can be large, CLAUDE.md rule 8's own caution) only when
 * `filter === 'stale-attributes'` actually asks for it, for the main/tag
 * arm below.
 *
 * #244: used to read `main` unconditionally regardless of the page's own
 * selected ref, so a branch's own additions/edits never showed up here.
 * Mirrors `useCapabilityLandscape.ts`'s main/tag-vs-branch split: a branch
 * ref reads the already-folded arrays off
 * `resolveBranchModeProjectionCached`'s `HeadProjection` and derives every
 * filter in memory (all of them are already `relationship_type`/
 * `element_type` equality filters over an already-in-memory array, never
 * an id-list `.in()` — CLAUDE.md rule 8 doesn't apply here) — the whole
 * projection is already in memory once resolved, so unlike the main/tag
 * arm's "only fetch facts/uses-flows_to when the filter needs them"
 * laziness, the branch arm derives everything unconditionally; main/tag
 * are unchanged, still the direct commit-scoped queries below.
 */
export function useElementBrowse(
  modelId: UUID,
  ref: Ref,
  mode: ViewMode,
  filter: ElementBrowseFilter = null,
  /** S1 item 15 (A2 remainder): the caller's own already-resolved main head commit id — same race-tolerant dedup shape `useDirectorHome.ts`'s own parameter comment explains, for the main/tag arm below. */
  mainCommitIdHint: UUID | null = null,
  /** The Completeness column's data and sort order; `null` until Portfolio rows have loaded. */
  completenessById: CompletenessById | null = null,
): ElementBrowseState {
  const staleAfterMonths = useStaleAfterMonths();
  const [status, setStatus] = useState<ElementBrowseStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  // One object, not three separate `useState`s: `commitId` and
  // `filteredIds` are only ever meaningful together with `allRows` (all
  // three come from the same `load()` round trip) — splitting them risked
  // exactly the "is commitId really set by the time status is 'ready'"
  // question a reviewer would have to trust a comment for instead of the
  // type system.
  const [base, setBase] = useState<BrowseBase | null>(null);
  const [filtered, setFiltered] = useState<{ base: BrowseBase; filterKey: string; ids: ReadonlySet<UUID> | null } | null>(null);
  const filterKey = filter !== null && typeof filter === 'object' ? JSON.stringify(filter) : (filter ?? '');
  // Only a result computed for this exact model load *and* this exact filter counts as loaded.
  const loaded = filtered?.base === base && filtered.filterKey === filterKey ? { allRows: filtered.base.rows, commitId: filtered.base.commitId, filteredIds: filtered.ids } : null;
  const [reloadToken, setReloadToken] = useState(0);
  const [typeFilter, setTypeFilter] = useState<ElementType | 'all'>('all');
  const [dispositionFilter, setDispositionFilter] = useState<DispositionFilter>('all');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<ElementBrowseSortKey>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const refParam = refParamOf(ref);

  // Effect 1 — the model itself, loaded once per model/ref/mode/reload. Changing only `filter`
  // never re-runs this (it used to refetch every element and edge on each filter change); the
  // extra reads a filter may need (facts, uses/flows_to, replaces, open-change retirements) are
  // memoised on `base`, so each runs at most once however many filters the user switches through.
  useEffect(() => {
    if (!modelId) return undefined;
    let cancelled = false;
    setStatus('loading');
    setBase(null);
    setFiltered(null);

    async function load(): Promise<void> {
      let resolvedCommitId: UUID;
      let elements: ElementsHeadRow[];
      let supportsEdges: RelationshipsHeadRow[];
      let ownsEdges: RelationshipsHeadRow[];
      let ownersByElementId: Map<UUID, ElementsHeadRow>;
      /** Deferred so the common filter logic below can `await` it only for the two filters that actually need it — a real query for main/tag, an already-in-memory filter for a branch ref (see this hook's own module comment). */
      let getFacts: () => Promise<FactStalenessRow[]>;
      let getUsesAndFlowsToEdges: () => Promise<RelationshipsHeadRow[]>;
      let getReplacesEdges: () => Promise<RelationshipsHeadRow[]>;

      if (ref.kind === 'branch') {
        const branch = await resolveBranchRef(supabase, ref);
        if (!branch) {
          if (!cancelled) setStatus('refNotFound');
          return;
        }
        const resolved = await resolveBranchModeProjectionCached(supabase, modelId, branch, mode);
        if (!resolved) {
          if (!cancelled) setStatus('refNotFound');
          return;
        }
        const { projection } = resolved;
        resolvedCommitId = resolved.commitId;
        elements = projection.elementsHead;
        supportsEdges = projection.relationshipsHead.filter((r) => r.relationship_type === 'supports');
        ownsEdges = projection.relationshipsHead.filter((r) => r.relationship_type === 'owns');
        const elementsByIdForOwners = new Map<UUID, ElementsHeadRow>(elements.map((e) => [e.element_id, e]));
        ownersByElementId = ownersByElementIdFromOwnsEdges(ownsEdges, elementsByIdForOwners);
        getFacts = () => Promise.resolve(projection.facts);
        getUsesAndFlowsToEdges = () => Promise.resolve(projection.relationshipsHead.filter((r) => r.relationship_type === 'uses' || r.relationship_type === 'flows_to'));
        getReplacesEdges = () => Promise.resolve(projection.relationshipsHead.filter((r) => r.relationship_type === 'replaces'));
      } else {
        const commitId = ref.kind === 'main' && mainCommitIdHint ? mainCommitIdHint : await resolveRef(supabase, modelId, ref);
        if (!commitId) {
          if (!cancelled) {
            setError('This model has no commits yet.');
            setStatus('error');
          }
          return;
        }
        resolvedCommitId = commitId;
        const [loadedElements, loadedSupportsEdges, loadedOwnsEdges] = await Promise.all([
          listAllElements(supabase, commitId),
          listAllSupportsEdges(supabase, commitId),
          listAllOwnsEdges(supabase, commitId),
        ]);
        elements = loadedElements;
        supportsEdges = loadedSupportsEdges;
        ownsEdges = loadedOwnsEdges;
        const elementsByIdForOwners = new Map<UUID, ElementsHeadRow>(elements.map((e) => [e.element_id, e]));
        // Reuses the `owns` edges fetched above (the same query `loadOwnersByElementId` would run again, one round trip later).
        ownersByElementId = ownersByElementIdFromOwnsEdges(ownsEdges, elementsByIdForOwners);
        getFacts = () => listFactStalenessForCommit(supabase, commitId);
        getUsesAndFlowsToEdges = () => listAllUsesAndFlowsToEdges(supabase, commitId);
        getReplacesEdges = () => listAllReplacesEdges(supabase, commitId);
      }
      const rows = buildBrowseRows(elements, ownersByElementId);

      if (!cancelled) {
        setBase({
          elements,
          supportsEdges,
          ownsEdges,
          rows,
          commitId: resolvedCommitId,
          getFacts: once(getFacts),
          getUsesAndFlowsToEdges: once(getUsesAndFlowsToEdges),
          getReplacesEdges: once(getReplacesEdges),
          getRetiredByOpenChanges: once(() => loadElementsRetiredByOpenChanges(supabase, modelId)),
        });
      }
    }

    load().catch((e: unknown) => {
      reportError("Couldn't load elements.", e);
      if (!cancelled) {
        setError(e instanceof Error ? e.message : 'Failed to load elements.');
        setStatus('error');
      }
    });

    return () => {
      cancelled = true;
    };
    // `ref`'s string form (`refParam`, computed above) is the real
    // dependency, not `ref` itself — same pitfall/fix as
    // useCapabilityLandscape.ts/useLandscape.ts.
  }, [modelId, refParam, mode, reloadToken, mainCommitIdHint]);

  // Effect 2 — which rows the current `filter` keeps, over the already-loaded `base`.
  useEffect(() => {
    if (!base) return undefined;
    const b: BrowseBase = base;
    let cancelled = false;
    const { elements, supportsEdges, ownsEdges } = b;
    const elementsById = new Map<UUID, ElementsHeadRow>(elements.map((e) => [e.element_id, e]));

    async function compute(): Promise<void> {
      let ids: Set<UUID> | null = null;
      if (filter === 'unlinked-systems') {
        const systems = elements.filter((e) => e.element_type === 'system');
        const containers = elements.filter((e) => e.element_type === 'container');
        ids = new Set(findSystemsWithoutCapability(systems, supportsEdges, containers).map((e) => e.element_id));
      } else if (filter === 'platform-supports-move-to-module') {
        const systems = elements.filter((e) => e.element_type === 'system');
        const containers = elements.filter((e) => e.element_type === 'container');
        ids = new Set(findPlatformSupportsThatShouldMoveToModule(systems, supportsEdges, containers).map((e) => e.element_id));
      } else if (filter === 'unowned-capabilities') {
        const capabilities = elements.filter((e) => e.element_type === 'capability');
        ids = new Set(findCapabilitiesWithoutOwner(capabilities, supportsEdges, ownsEdges).map((e) => e.element_id));
      } else if (filter === 'stale-attributes') {
        const facts = await b.getFacts();
        ids = new Set(computeStaleAttributesFinding(facts, elements, new Date(), staleAfterMonths).staleElements.map((e) => e.element_id));
      } else if (filter === 'no-technical-owner') {
        const systems = elements.filter((e) => e.element_type === 'system');
        const containers = elements.filter((e) => e.element_type === 'container');
        ids = new Set(findSystemsWithoutTechnicalOwner([...systems, ...containers], ownsEdges).map((e) => e.element_id));
      } else if (filter === 'ai-agent-no-technical-owner') {
        const systems = elements.filter((e) => e.element_type === 'system');
        ids = new Set(findAiAgentsActingAloneWithoutTechnicalOwner(systems, ownsEdges).map((e) => e.element_id));
      } else if (filter === 'ai-agents') {
        ids = new Set(elements.filter((e) => e.element_type === 'system' && isAiAgent(e)).map((e) => e.element_id));
      } else if (filter === 'uses-ai') {
        ids = new Set(elements.filter((e) => e.element_type === 'system' && usesAi(e)).map((e) => e.element_id));
      } else if (filter === 'critical-no-business-owner') {
        const systems = elements.filter((e) => e.element_type === 'system');
        const containers = elements.filter((e) => e.element_type === 'container');
        ids = new Set(findCriticalSystemsWithoutBusinessOwner([...systems, ...containers], ownsEdges).map((e) => e.element_id));
      } else if (filter === 'critical-exposed') {
        const systems = elements.filter((e) => e.element_type === 'system');
        const replacesEdges = await b.getReplacesEdges();
        ids = new Set(findCriticalExposedSystems(systems, new Date(), replacedElementIds(replacesEdges)).map((e) => e.element_id));
      } else if (filter === 'unused-integration-platform') {
        const systems = elements.filter((e) => e.element_type === 'system');
        const usesAndFlowsToEdges = await b.getUsesAndFlowsToEdges();
        const containers = elements.filter((e) => e.element_type === 'container');
        ids = new Set(findUnusedIntegrationPlatforms(systems, usesAndFlowsToEdges, containers).map((e) => e.element_id));
      } else if (filter === 'unused-integration-interface') {
        const systems = elements.filter((e) => e.element_type === 'system');
        const containers = elements.filter((e) => e.element_type === 'container');
        const usesAndFlowsToEdges = await b.getUsesAndFlowsToEdges();
        ids = new Set(findUnusedIntegrationInterfaces(systems, containers, usesAndFlowsToEdges).map((e) => e.element_id));
      } else if (filter === 'essential-no-technical-owner') {
        const systems = elements.filter((e) => e.element_type === 'system');
        const containers = elements.filter((e) => e.element_type === 'container');
        const capabilities = elements.filter((e) => e.element_type === 'capability');
        ids = new Set(findSystemsSupportingEssentialFunctionWithoutTechnicalOwner([...systems, ...containers], capabilities, supportsEdges, ownsEdges).map((e) => e.element_id));
      } else if (filter === 'critical-support-end') {
        const systems = elements.filter((e) => e.element_type === 'system');
        ids = new Set(findCriticalSystemsPastOrNearSupportEnd(systems).map((e) => e.element_id));
      } else if (filter === 'capability-no-supporters') {
        const capabilities = elements.filter((e) => e.element_type === 'capability');
        const level1Capabilities = computeCapabilityMapTree(capabilities).l1.map((column) => column.capability);
        ids = new Set(findCapabilitiesWithNoSupporters(level1Capabilities, capabilities, supportsEdges, ownsEdges).map((e) => e.element_id));
      } else if (filter === 'outgoing-no-retiring-change') {
        const retiring = await b.getRetiredByOpenChanges();
        const candidates = elements.filter((e) => e.element_type === 'system' || e.element_type === 'container');
        ids = new Set(findOutgoingWithoutRetiringChange(candidates, retiring, elementsById).map((e) => e.element_id));
      } else if (filter === 'lifecycle-date-mismatch') {
        ids = new Set(findLifecycleDateMismatches(elements, new Date()).map((m) => m.element.element_id));
      } else if (filter !== null && typeof filter === 'object') {
        // F1 PR4: an org-defined attribute's own equality filter — `value`
        // arrives already parsed to the definition's `kind` by the caller,
        // so this is a plain `===`, never a second parse here.
        ids = new Set(elements.filter((e) => attributesRecord(e.attributes)[filter.custom] === filter.value).map((e) => e.element_id));
      }

      if (!cancelled) {
        setFiltered({ base: b, filterKey, ids });
        setStatus('ready');
      }
    }

    compute().catch((e: unknown) => {
      reportError("Couldn't load elements.", e);
      if (!cancelled) {
        setError(e instanceof Error ? e.message : 'Failed to load elements.');
        setStatus('error');
      }
    });

    return () => {
      cancelled = true;
    };
    // `filterKey` stands in for `filter` (an object for a custom-attribute filter) so a caller
    // passing a fresh-but-equal object never re-runs this.
  }, [base, filterKey, staleAfterMonths]);

  const setSort = (key: ElementBrowseSortKey) => {
    if (sortKeyEquals(key, sortKey)) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const rows = useMemo(() => {
    if (!loaded) return [];
    const q = query.trim().toLowerCase();
    const filtered = loaded.allRows.filter((row) => {
      if (loaded.filteredIds && !loaded.filteredIds.has(row.element.element_id)) return false;
      if (typeFilter !== 'all' && row.element.element_type !== typeFilter) return false;
      if (!matchesDispositionFilter(row, dispositionFilter)) return false;
      if (q === '') return true;
      return row.element.name.toLowerCase().includes(q) || (row.owner?.name.toLowerCase().includes(q) ?? false);
    });
    const sorted = [...filtered].sort((a, b) => compareRows(a, b, sortKey, completenessById));
    return sortDirection === 'asc' ? sorted : sorted.reverse();
  }, [loaded, typeFilter, dispositionFilter, query, sortKey, sortDirection, completenessById]);

  if (status === 'error') return { status: 'error', message: error ?? 'Failed to load elements.' };
  if (status === 'refNotFound') return { status: 'refNotFound' };
  if (status === 'loading' || !loaded) return { status: 'loading' };
  return {
    status: 'ready',
    rows,
    completenessById,
    typeFilter,
    setTypeFilter,
    dispositionFilter,
    setDispositionFilter,
    query,
    setQuery,
    sortKey,
    sortDirection,
    setSort,
    commitId: loaded.commitId,
    restore: (next) => {
      setTypeFilter(next.typeFilter);
      setDispositionFilter(next.dispositionFilter);
      setQuery(next.query);
      setSortKey(next.sortKey);
      setSortDirection(next.sortDirection);
    },
    reload: () => { setReloadToken((t) => t + 1); },
  };
}
