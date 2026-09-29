import { useEffect, useMemo, useState } from 'react';
import type { Criticality, ElementType, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, FactsRow, Json, RelationshipsHeadRow } from '../../contracts/rows';
import { CRITICALITY_ORDER } from './criticalityTone';
import { listAllElements, loadOwnersByElementId, ownersByElementIdFromOwnsEdges, lifecycleStatusOf, criticalityOf, type BrowseRow } from '../../db/elementBrowse';
import { attributesRecord } from './attributesRecord';
import { compareCustomAttributeValues, sortKeyEquals, type ElementBrowseSortKey } from './elementBrowseSort';
import { moduleDisplayName } from './moduleDisplayName';
import {
  computeStaleAttributesFinding,
  findCapabilitiesWithNoSupporters,
  findCapabilitiesWithoutOwner,
  findCriticalExposedSystems,
  findCriticalSystemsPastOrNearSupportEnd,
  findCriticalSystemsWithoutBusinessOwner,
  findPlatformSupportsThatShouldMoveToModule,
  findSystemsSupportingEssentialFunctionWithoutTechnicalOwner,
  findSystemsWithoutCapability,
  findSystemsWithoutTechnicalOwner,
  findUnusedIntegrationPlatforms,
  listAllOwnsEdges,
  listAllUsesAndFlowsToEdges,
  listFactsForCommit,
} from '../../db/healthFindings';
import { listAllSupportsEdges } from '../../db/modelHome';
import { computeCapabilityMapTree } from '../capabilityMap/layout';
import { refParamOf, resolveBranchRef, resolveRef, type Ref } from '../../db/ref';
import type { ViewMode } from '../../db/viewMode';
import { resolveBranchModeProjectionCached } from '../query/cachedBranchProjection';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

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
  | 'critical-no-business-owner'
  | 'critical-exposed'
  | 'unused-integration-platform'
  | 'essential-no-technical-owner'
  | 'critical-support-end'
  /** Per-item-actions prompt: the third decision-shaped finding, `findCapabilitiesWithNoSupporters`'s own filter key (`ArchitectHome.tsx`'s `capability-no-supporters` check). */
  | 'capability-no-supporters'
  | CustomAttributeBrowseFilter
  | null;

export type ElementBrowseState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'refNotFound' }
  | {
      status: 'ready';
      rows: BrowseRow[];
      typeFilter: ElementType | 'all';
      setTypeFilter: (type: ElementType | 'all') => void;
      query: string;
      setQuery: (query: string) => void;
      sortKey: ElementBrowseSortKey;
      sortDirection: 'asc' | 'desc';
      setSort: (key: ElementBrowseSortKey) => void;
      /** The commit every row was read at — `RelationshipAdd`'s own search needs this, for the inline supports picker on an unlinked-systems row. */
      commitId: UUID;
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

function compareRows(a: BrowseRow, b: BrowseRow, key: ElementBrowseSortKey): number {
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
  }
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
): ElementBrowseState {
  const [status, setStatus] = useState<ElementBrowseStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  // One object, not three separate `useState`s: `commitId` and
  // `filteredIds` are only ever meaningful together with `allRows` (all
  // three come from the same `load()` round trip) — splitting them risked
  // exactly the "is commitId really set by the time status is 'ready'"
  // question a reviewer would have to trust a comment for instead of the
  // type system.
  const [loaded, setLoaded] = useState<{ allRows: BrowseRow[]; commitId: UUID; filteredIds: ReadonlySet<UUID> | null } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [typeFilter, setTypeFilter] = useState<ElementType | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<ElementBrowseSortKey>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const refParam = refParamOf(ref);

  useEffect(() => {
    if (!modelId) return undefined;
    let cancelled = false;
    setStatus('loading');

    async function load(): Promise<void> {
      let resolvedCommitId: UUID;
      let elements: ElementsHeadRow[];
      let supportsEdges: RelationshipsHeadRow[];
      let ownsEdges: RelationshipsHeadRow[];
      let ownersByElementId: Map<UUID, ElementsHeadRow>;
      /** Deferred so the common filter logic below can `await` it only for the two filters that actually need it — a real query for main/tag, an already-in-memory filter for a branch ref (see this hook's own module comment). */
      let getFacts: () => Promise<FactsRow[]>;
      let getUsesAndFlowsToEdges: () => Promise<RelationshipsHeadRow[]>;

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
        ownersByElementId = await loadOwnersByElementId(supabase, commitId, elementsByIdForOwners);
        getFacts = () => listFactsForCommit(supabase, commitId);
        getUsesAndFlowsToEdges = () => listAllUsesAndFlowsToEdges(supabase, commitId);
      }
      const elementsById = new Map<UUID, ElementsHeadRow>(elements.map((e) => [e.element_id, e]));

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
        const systems = elements.filter((e) => e.element_type === 'system');
        const facts = await getFacts();
        ids = new Set(computeStaleAttributesFinding(facts, systems).staleSystems.map((e) => e.element_id));
      } else if (filter === 'no-technical-owner') {
        const systems = elements.filter((e) => e.element_type === 'system');
        const containers = elements.filter((e) => e.element_type === 'container');
        ids = new Set(findSystemsWithoutTechnicalOwner([...systems, ...containers], ownsEdges).map((e) => e.element_id));
      } else if (filter === 'critical-no-business-owner') {
        const systems = elements.filter((e) => e.element_type === 'system');
        const containers = elements.filter((e) => e.element_type === 'container');
        ids = new Set(findCriticalSystemsWithoutBusinessOwner([...systems, ...containers], ownsEdges).map((e) => e.element_id));
      } else if (filter === 'critical-exposed') {
        const systems = elements.filter((e) => e.element_type === 'system');
        ids = new Set(findCriticalExposedSystems(systems).map((e) => e.element_id));
      } else if (filter === 'unused-integration-platform') {
        const systems = elements.filter((e) => e.element_type === 'system');
        const usesAndFlowsToEdges = await getUsesAndFlowsToEdges();
        ids = new Set(findUnusedIntegrationPlatforms(systems, usesAndFlowsToEdges).map((e) => e.element_id));
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
      } else if (filter !== null && typeof filter === 'object') {
        // F1 PR4: an org-defined attribute's own equality filter — `value`
        // arrives already parsed to the definition's `kind` by the caller,
        // so this is a plain `===`, never a second parse here.
        ids = new Set(elements.filter((e) => attributesRecord(e.attributes)[filter.custom] === filter.value).map((e) => e.element_id));
      }

      const rows: BrowseRow[] = elements.map((element) => {
        const parent = element.parent_id !== null ? (elementsById.get(element.parent_id) ?? null) : null;
        return {
          element,
          owner: ownersByElementId.get(element.element_id) ?? null,
          // `parent` threaded through so a module whose own lifecycle/
          // criticality is unset reads as its platform's, rather than
          // blank — `lifecycleStatusOf`/`criticalityOf`'s own doc comment.
          lifecycleStatus: lifecycleStatusOf(element, parent),
          criticality: criticalityOf(element, parent),
          parent,
        };
      });

      if (!cancelled) {
        setLoaded({ allRows: rows, commitId: resolvedCommitId, filteredIds: ids });
        setStatus('ready');
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
  }, [modelId, refParam, mode, filter, reloadToken, mainCommitIdHint]);

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
      if (q === '') return true;
      return row.element.name.toLowerCase().includes(q) || (row.owner?.name.toLowerCase().includes(q) ?? false);
    });
    const sorted = [...filtered].sort((a, b) => compareRows(a, b, sortKey));
    return sortDirection === 'asc' ? sorted : sorted.reverse();
  }, [loaded, typeFilter, query, sortKey, sortDirection]);

  if (status === 'error') return { status: 'error', message: error ?? 'Failed to load elements.' };
  if (status === 'refNotFound') return { status: 'refNotFound' };
  if (status === 'loading' || !loaded) return { status: 'loading' };
  return {
    status: 'ready',
    rows,
    typeFilter,
    setTypeFilter,
    query,
    setQuery,
    sortKey,
    sortDirection,
    setSort,
    commitId: loaded.commitId,
    reload: () => { setReloadToken((t) => t + 1); },
  };
}
