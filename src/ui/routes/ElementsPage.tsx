import { useParams, useSearchParams } from 'react-router';
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
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { useElementBrowse, type ElementBrowseFilter } from '../elements/useElementBrowse';
import styles from './ElementsPage.module.css';

const VALID_FILTERS: readonly ElementBrowseFilter[] = [
  'unlinked-systems',
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
  const [searchParams] = useSearchParams();
  const filter = parseFilterParam(searchParams.get('filter'));
  const { userId } = useAuth();
  const { ref } = useSelectedRef();
  const { label: branchLabel } = useBranchLabel(ref);

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const canEdit = canEditOnMain(role);
  const { branch: mainBranch, reload: reloadMainBranch } = useMainBranch(model?.id ?? null);

  const state = useElementBrowse(model?.id ?? '', filter);
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
          <EditingBranchBanner activeRef={ref} showModeShortcuts={false} />
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
            unresolvedCounts={threadCounts}
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
