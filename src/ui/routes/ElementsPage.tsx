import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { AttributeDefinitionKind } from '../../contracts/attributeSchema';
import type { Json } from '../../contracts/rows';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ElementBrowseTable } from '../components/ElementBrowseTable/ElementBrowseTable';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useThreadCounts } from '../comments/useThreadCounts';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useMainBranch } from '../branches/useMainBranch';
import { useSelectedRef } from '../branches/useSelectedRef';
import { refLabelOf } from '../../db/ref';
import { useModels } from '../models/useModels';
import { canEditOnMain, useMembership } from '../orgs/useMembership';
import { useAttributeDefinitions } from '../orgs/useAttributeDefinitions';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { useElementBrowse, type ElementBrowseFilter } from '../elements/useElementBrowse';
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
 * doors": `ModelHome.tsx` links here, and this page itself always reads
 * `main` (browsing is a director/architect-door affordance, not a
 * branch-scoped view; open an element from here to edit it at whatever
 * ref that page supports).
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
  const { branch: mainBranch, reload: reloadMainBranch } = useMainBranch(model?.id ?? null);
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

  const state = useElementBrowse(model?.id ?? '', filter, mainBranch?.head_commit_id ?? null);
  const onLinked = () => {
    reloadMainBranch();
    if (state.status === 'ready') state.reload();
  };
  // M1 close-out item 4: "unresolved counts on the browse table rows" —
  // one batched RPC over every row currently on screen (post-filter/search/
  // sort, same as everywhere else `useThreadCounts` is used), not a query
  // per row.
  const threadCountsState = useThreadCounts(model?.id ?? null, state.status === 'ready' ? state.rows.map((r) => r.element.element_id) : []);
  const threadCounts = threadCountsState.status === 'ready' ? threadCountsState.counts : undefined;

  if (orgLoading || modelsLoading || !model) {
    return (
      <div>
        <AppHeader />
        <div className={navStyles.body}>
          <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
          <main className={styles.main}>
            <Text tone="muted">Loading…</Text>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AppHeader />
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
            linkSupportsInline={
              filter === 'unlinked-systems' && canEdit && mainBranch
                ? {
                    modelId: model.id,
                    orgId: organisation?.id ?? '',
                    userId,
                    branch: mainBranch,
                    expectedHeadCommitId: mainBranch.head_commit_id,
                    onLinked,
                  }
                : undefined
            }
          />
        </main>
      </div>
    </div>
  );
}
