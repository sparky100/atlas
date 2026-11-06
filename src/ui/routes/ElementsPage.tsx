import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { AttributeDefinitionKind } from '../../contracts/attributeSchema';
import type { Json } from '../../contracts/rows';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ElementBrowseTable } from '../components/ElementBrowseTable/ElementBrowseTable';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useThreadCounts } from '../comments/useThreadCounts';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useEditingBranch } from '../branches/useEditingBranch';
import { hintedModelId, useMainBranch } from '../branches/useMainBranch';
import { useSelectedRef } from '../branches/useSelectedRef';
import { refLabelOf } from '../../db/ref';
import { HomeSearch } from '../home/HomeSearch';
import { useModels } from '../models/useModels';
import { canCreateChangeBranch, canEditOnMain, canStartDecision, useMembership } from '../orgs/useMembership';
import { useAttributeDefinitions } from '../orgs/useAttributeDefinitions';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { useElementBrowse, type ElementBrowseFilter } from '../elements/useElementBrowse';
import type { BrowseRow } from '../../db/elementBrowse';
import { StartProjectLink } from '../projects/StartProjectLink';
import { canEditBranch, canStartProject } from '../orgs/roleGates';
import { attributeDefinitionToFieldSchema } from '../../contracts/attributeSchema';
import { useBulkEdit } from '../elements/useBulkEdit';
import { useAttestation } from '../elements/useAttestation';
import { decisionPrefillToSearchParams, prefillFromCapabilityNoSupportersFinding, prefillFromCriticalExposedFinding, prefillFromCriticalSupportEndFinding, prefillFromOutgoingDisposition } from '../decisions/decisionPrefill';
import { StartDecisionLink } from '../decisions/StartDecisionLink';
import { useRouteTiming } from '../perf/useRouteTiming';
import { SavedReportBar } from '../reports/SavedReportBar';
import { elementsStateToSpec, specToElementsState } from '../reports/elementsReport';
import styles from './ElementsPage.module.css';

const VALID_FILTERS: readonly ElementBrowseFilter[] = [
  'unlinked-systems',
  'platform-supports-move-to-module',
  'unowned-capabilities',
  'stale-attributes',
  'no-technical-owner',
  'critical-no-business-owner',
  'critical-exposed',
  'unused-integration-platform',
  'unused-integration-interface',
  // Bug fix (per-item-actions prompt): these two were reachable already
  // (ArchitectHome.tsx's own `browseHref('essential-no-technical-owner')`/
  // `browseHref('critical-support-end')`) but missing here, so
  // `parseFilterParam` silently discarded them back to `null` and both
  // links landed on the *unfiltered* browse table.
  'essential-no-technical-owner',
  'critical-support-end',
  'capability-no-supporters',
  'outgoing-no-retiring-change',
];

function parseFilterParam(value: string | null): ElementBrowseFilter {
  return VALID_FILTERS.includes(value as ElementBrowseFilter) ? (value as ElementBrowseFilter) : null;
}

/** F1 ("custom attributes") PR4: `?customValue=` is always a raw URL string — parsed to the chosen definition's own `kind` before it ever reaches `useElementBrowse`'s equality filter, which never re-parses it. */
function parseCustomFilterValue(kind: AttributeDefinitionKind, raw: string): Json {
  if (kind === 'number') {
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? raw : parsed;
  }
  if (kind === 'boolean') return raw === 'true';
  return raw;
}

/**
 * The element browse table's route (Sprint U3b) — "reachable from both
 * doors": `ModelHome.tsx` links here. #244: this page used to always read
 * `main` regardless of the selected ref, so a branch's own additions/edits
 * never showed up here — it now reads whatever ref is selected, same as
 * every other branch-aware page (`useElementBrowse.ts`'s own module
 * comment has the mechanism). Always the branch's own current state
 * (`'toBe'`) — this page has no As-is/To-be/Diff selector of its own,
 * same choice `CapabilityMapPage.tsx` makes for the same reason.
 *
 * Sprint U4-1 B3 adds `?filter=`: the architect door's Health findings
 * panel links here pre-filtered to a finding (`ArchitectHome.tsx`'s own
 * `browseHref`) — `useElementBrowse` does the actual filtering, this page
 * just reads and validates the query param. The `unlinked-systems` filter
 * also gets the "supports picker inline per row" the sprint item names
 * explicitly: `RelationshipAdd` (the exact control an element page's own
 * "+ Add supports" already uses) rendered once per row, needing this
 * page's own edit-rights gate and main-branch context — nothing an
 * unfiltered browse (read-only, no edit rights needed to just look) ever
 * required before.
 */
export function ElementsPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { userId } = useAuth();
  const { ref } = useSelectedRef();
  const { label: branchLabel } = useBranchLabel(ref);

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const canEdit = canEditOnMain(role);
  const navigate = useNavigate();
  const { branch: mainBranch, loading: mainBranchLoading, reload: reloadMainBranch } = useMainBranch(model?.id ?? null);
  // Same search-first "type a name, find it or create it" control the front
  // doors use (`ModelHome.tsx`'s own `HomeSearch` wiring, verbatim) — a
  // browse table is exactly where "does this already exist?" matters most,
  // so it gets the identical duplicate-catching create path rather than a
  // second, bespoke one.
  const { branch: editingBranch } = useEditingBranch(model?.id ?? null, ref);
  const canShowSearch = canCreateChangeBranch(role);
  // F1 ("custom attributes") PR4: read-only here, same reuse as
  // ElementPage.tsx's own PR3 wiring — any member can see these
  // (attribute_definitions_select's RLS), and this page only ever filters/
  // sorts by them, never edits the definitions themselves.
  const { definitions: attributeDefinitions } = useAttributeDefinitions(organisation?.id ?? null, userId);

  // `?customAttr=`/`?customValue=` are mutually exclusive with the named
  // `?filter=` (a browse is filtered by one thing at a time, matching this
  // page's existing single-`filter` shape). Memoized on `searchParams`
  // (stable across renders that don't change the URL, same convention
  // `LandscapePage.tsx`'s own `parseLandscapeFilters` memo uses) — an
  // object filter built fresh every render would otherwise retrigger
  // `useElementBrowse`'s own fetch effect every render, since its
  // dependency array compares `filter` by reference.
  const customAttrKey = searchParams.get('customAttr');
  const customValueRaw = searchParams.get('customValue');
  const filter = useMemo<ElementBrowseFilter>(() => {
    if (customAttrKey !== null) {
      const definition = attributeDefinitions.find((d) => d.key === customAttrKey);
      if (definition && customValueRaw !== null) {
        return { custom: definition.key, value: parseCustomFilterValue(definition.kind, customValueRaw) };
      }
      // A definition is selected (driving the picker + the dynamic column)
      // but no value has been chosen yet — not a real filter, so fall
      // through to "no filter" rather than filtering on an empty value.
      return null;
    }
    return parseFilterParam(searchParams.get('filter'));
  }, [searchParams, customAttrKey, customValueRaw, attributeDefinitions]);

  const setCustomAttrParams = (next: { key: string | null; value: string | null }) => {
    const params = new URLSearchParams(searchParams);
    if (next.key === null) {
      params.delete('customAttr');
      params.delete('customValue');
    } else {
      params.set('customAttr', next.key);
      if (next.value === null) params.delete('customValue');
      else params.set('customValue', next.value);
      // A custom attribute filter replaces any named finding filter — the
      // two are never combined.
      params.delete('filter');
    }
    setSearchParams(params);
  };

  // The `?filter=` finding, now pickable from the toolbar
  // (`FINDING_FILTER_OPTIONS`, `ElementBrowseTable.tsx`) rather than only
  // reachable via ArchitectHome's own deep links — same mutual-exclusion
  // with the custom attribute filter as `setCustomAttrParams` above.
  const setFindingFilter = (next: string) => {
    const params = new URLSearchParams(searchParams);
    params.delete('customAttr');
    params.delete('customValue');
    if (next === '') params.delete('filter');
    else params.set('filter', next);
    setSearchParams(params);
  };

  const state = useElementBrowse(hintedModelId(model?.id, ref, mainBranchLoading) ?? '', ref, 'toBe', filter, mainBranch?.head_commit_id ?? null);
  // E8 ("performance") phase 1: this route's own resolve/first-paint/data-complete marks — see useRouteTiming.ts's own module comment.
  useRouteTiming('elements', state.status === 'ready');
  const onLinked = () => {
    reloadMainBranch();
    if (state.status === 'ready') state.reload();
  };
  // M1 close-out item 4: "unresolved counts on the browse table rows" —
  // one batched RPC over every row currently on screen (post-filter/search/
  // sort, same as everywhere else `useThreadCounts` is used), not a query
  // per row.
  // F12 step 1: the grid writes where the element page's own Edit writes —
  // the selected draft change, or main — behind the same gate
  // (`canEditBranch`).
  const bulkEditBranch = editingBranch ?? (ref.kind === 'main' ? mainBranch : null);
  const bulkEditCustomFields = useMemo(
    () => new Map(attributeDefinitions.filter((d) => d.deprecated_at === null).map((d) => [d.key, { field: attributeDefinitionToFieldSchema(d), appliesTo: d.applies_to }])),
    [attributeDefinitions],
  );
  const bulkEdit = useBulkEdit({ modelId: model?.id ?? '', orgId: organisation?.id ?? '', userId, branch: bulkEditBranch, customFields: bulkEditCustomFields, onSaved: onLinked });
  const canBulkEdit = bulkEditBranch !== null && canEditBranch(role, bulkEditBranch);
  const attestation = useAttestation({ modelId: model?.id ?? '', orgId: organisation?.id ?? '', userId, branch: bulkEditBranch, onConfirmed: onLinked });
  const threadCountsState = useThreadCounts(model?.id ?? null, state.status === 'ready' ? state.rows.map((r) => r.element.element_id) : []);
  const threadCounts = threadCountsState.status === 'ready' ? threadCountsState.counts : undefined;

  if (orgLoading || modelsLoading || !model) {
    return (
      <div>
        <AppHeader orgId={organisation?.id ?? null} />
        <div className={navStyles.body}>
          <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
          <main className={styles.main}>
            <Text tone="muted">Loading…</Text>
          </main>
        </div>
      </div>
    );
  }

  // Per-item-actions prompt: "each row [in a decision-shaped finding's
  // filtered list] carries its own pre-filled Start a decision" — only the
  // three decision-shaped filters get this column at all (a housekeeping
  // filter like `unlinked-systems` keeps its own `linkSupportsInline`
  // action instead, never both), and only for a viewer who could actually
  // start one (`canStartDecision`, the same role floor every other "Start
  // a decision" entry point already uses).
  const decisionRowAction =
    canStartDecision(role) && (filter === 'critical-support-end' || filter === 'critical-exposed' || filter === 'capability-no-supporters')
      ? (row: BrowseRow) => {
          const element = { id: row.element.element_id, name: row.element.name };
          const prefill =
            filter === 'critical-support-end'
              ? prefillFromCriticalSupportEndFinding(element)
              : filter === 'critical-exposed'
                ? prefillFromCriticalExposedFinding(element)
                : prefillFromCapabilityNoSupportersFinding(element);
          const params = decisionPrefillToSearchParams(prefill).toString();
          return (
            <span className={styles.rowActions}>
              <StartDecisionLink href={`/o/${orgSlug ?? ''}/m/${model.slug}/decisions?${params}`} />
              {canStartProject(role) && <StartProjectLink href={`/o/${orgSlug ?? ''}/m/${model.slug}/projects?${params}`} />}
            </span>
          );
        }
      : canStartProject(role) && filter === 'outgoing-no-retiring-change'
        ? (row: BrowseRow) => {
            // F11: the work an outgoing disposition implies is a project, not a decision — the decision was the disposition itself.
            const prefill = prefillFromOutgoingDisposition(
              { id: row.element.element_id, name: row.element.name },
              row.disposition === 'eliminate' ? 'eliminate' : 'migrate',
            );
            const params = decisionPrefillToSearchParams(prefill).toString();
            return (
              <span className={styles.rowActions}>
                <StartProjectLink href={`/o/${orgSlug ?? ''}/m/${model.slug}/projects?${params}`} />
              </span>
            );
          }
        : undefined;

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} showModeShortcuts={false} />
          <Breadcrumb
            org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }}
            model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
            refLabel={refLabelOf(ref, branchLabel)}
          />
          <Text as="h1" size="2xl">
            Elements
          </Text>
          {canShowSearch && mainBranch && (
            <Panel>
              <HomeSearch
                modelId={model.id}
                orgId={organisation?.id ?? ''}
                userId={userId}
                role={role}
                searchCommitId={mainBranch.head_commit_id}
                activeRef={ref}
                editingBranch={editingBranch}
                orgSlug={organisation?.slug ?? ''}
                modelSlug={model.slug}
              />
            </Panel>
          )}
          {state.status === 'ready' && organisation && (
            <SavedReportBar
              source="elements"
              modelId={model.id}
              orgId={organisation.id}
              userId={userId}
              role={role}
              current={elementsStateToSpec(
                {
                  typeFilter: state.typeFilter,
                  dispositionFilter: state.dispositionFilter,
                  query: state.query,
                  sortKey: state.sortKey,
                  sortDirection: state.sortDirection,
                  custom: filter !== null && typeof filter === 'object' ? { key: filter.custom, value: filter.value } : null,
                },
                customAttrKey === null ? searchParams.get('filter') : null,
              )}
              onOpen={(spec) => {
                const restored = specToElementsState(spec);
                if (!restored.ok) return restored.reason;
                const next = restored.state;
                state.restore(next);
                // The custom-attribute filter lives in the URL; a saved report replaces it (and any finding filter) outright.
                const params = new URLSearchParams(searchParams);
                params.delete('filter');
                params.delete('customAttr');
                params.delete('customValue');
                if (next.custom !== null) {
                  params.set('customAttr', next.custom.key);
                  params.set('customValue', typeof next.custom.value === 'string' ? next.custom.value : JSON.stringify(next.custom.value));
                }
                setSearchParams(params);
                return null;
              }}
            />
          )}
          <ElementBrowseTable
            state={state}
            orgSlug={organisation?.slug ?? ''}
            modelSlug={model.slug}
            modelId={model.id}
            filenameBase={model.name}
            unresolvedCounts={threadCounts}
            attributeDefinitions={attributeDefinitions}
            customAttr={{ key: customAttrKey, value: customValueRaw }}
            onCustomAttrChange={setCustomAttrParams}
            findingFilter={customAttrKey === null ? (searchParams.get('filter') ?? '') : ''}
            onFindingFilterChange={setFindingFilter}
            linkSupportsInline={
              filter === 'unlinked-systems' && canEdit && mainBranch
                ? {
                    modelId: model.id,
                    orgId: organisation?.id ?? '',
                    userId,
                    // #244: this used to hardcode `mainBranch` as the write
                    // target regardless of the selected ref — the same
                    // editing-branch fallback `HomeSearch` already uses
                    // (`editingBranch`, falling back to `mainBranch` only
                    // when on main), so this page has one consistent write
                    // target rather than two.
                    branch: editingBranch ?? mainBranch,
                    expectedHeadCommitId: (editingBranch ?? mainBranch).head_commit_id,
                    onLinked,
                  }
                : undefined
            }
            decisionRowAction={decisionRowAction}
            onImportClick={canEdit ? () => { void navigate(`/o/${orgSlug ?? ''}/m/${model.slug}/capture`); } : undefined}
            bulkEdit={canBulkEdit ? bulkEdit : undefined}
            attest={
              canBulkEdit
                ? {
                    confirmingId: attestation.confirmingId,
                    confirm: (element) => {
                      void attestation.confirm(element, bulkEditBranch.head_commit_id);
                    },
                  }
                : undefined
            }
          />
          {attestation.error !== null && (
            <div role="alert">
              <Text as="p" size="sm">
                {attestation.error}
              </Text>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
