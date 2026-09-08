import { useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb, type BreadcrumbSegment } from '../components/Breadcrumb/Breadcrumb';
import { Button } from '../components/Button/Button';
import { DiffLegend } from '../components/DiffBadge/DiffLegend';
import { ElementSearchAdd } from '../components/ElementSearchAdd/ElementSearchAdd';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useModels } from '../models/useModels';
import { canEditBranch, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { parseRefParam, refLabelOf, refParamOf } from '../../db/ref';
import { parseViewMode } from '../../db/viewMode';
import { BranchViewModeControl } from '../branches/BranchViewModeControl';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useEditingBranch } from '../branches/useEditingBranch';
import { useMainBranch } from '../branches/useMainBranch';
import { LandscapeCanvas } from '../landscape/LandscapeCanvas';
import { useLandscape } from '../landscape/useLandscape';
import { useBreadcrumbElement } from '../nav/useBreadcrumbElement';
import { parseCapabilityParam, zoomQueryString } from '../nav/zoomParams';
import styles from './LandscapePage.module.css';

/**
 * The Landscape view (UI-principles.md §6.1, Sprint U1 step 4a): systems in
 * swim-lanes by the capability they support, `uses`/`flows_to` edges
 * between them. Sprint U2 step 3 adds the "optional capability filter"
 * §6.1's own Landscape row names (`?capability=`, src/ui/nav/zoomParams.ts)
 * — the zoom chain's second stop, reached from a capability tile's own
 * "→ Landscape" link — and Context/Container/Component, which reuse the
 * same renderer with their own query and layout preset (this step, not a
 * later one anymore). No Web Worker for those three (see their own view
 * comments); the landscape itself keeps its Sprint U1 4b worker/viewport-
 * culling/LOD work — the only view kind with §8.6's performance budget.
 *
 * Blocking: element creation adds the search-first "Add" control here for
 * systems and actors (src/ui/components/ElementSearchAdd/ElementSearchAdd.tsx)
 * — the empty-state affordance the landscape never had before ("Add a
 * System from the element page" pointed at a page you could only reach by
 * already knowing a system's id, i.e. nowhere).
 */
export function LandscapePage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const ref = parseRefParam(searchParams.get('ref'));
  const mode = parseViewMode(searchParams.get('mode'));
  const capabilityId = parseCapabilityParam(searchParams.get('capability'));
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const capability = useBreadcrumbElement(model?.id ?? '', ref, capabilityId);
  const { label: branchLabel } = useBranchLabel(ref);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const { branch: editingBranch } = useEditingBranch(model?.id ?? null, ref);
  // Search always scans main's real head, regardless of which ref/branch is
  // being viewed (src/db/elementSearch.ts's own module comment) — only the
  // write target (`editingBranch`) varies with the ref.
  const { branch: mainBranch } = useMainBranch(model?.id ?? null);
  const canEdit = editingBranch !== null && canEditBranch(role, editingBranch);
  // ADR-018 guarantees both are never null in practice (every branch always
  // has a real head, from genesis onward) — `BranchRow`'s own type hasn't
  // been narrowed to match yet (a separate, wider cleanup touching every
  // `!branch.head_commit_id` guard in src/db), so this control checks it
  // explicitly rather than asserting it away.
  const searchCommitId = mainBranch?.head_commit_id ?? null;
  const writeHeadCommitId = editingBranch?.head_commit_id ?? null;
  const canAdd = canEdit && searchCommitId !== null && writeHeadCommitId !== null;

  const { state, resetLayout } = useLandscape(model?.id ?? '', organisation?.id ?? '', userId, ref, mode, capabilityId);

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

  const refParam = refParamOf(ref);
  const segments: BreadcrumbSegment[] = capability ? [{ label: capability.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}/capability-map?ref=${refParam}` }] : [];
  const nodeHref = (systemId: string) => `/o/${orgSlug ?? ''}/m/${model.slug}/context/${systemId}?${zoomQueryString({ ref, capabilityId })}`;

  return (
    <div>
      <AppHeader />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
        <Breadcrumb
          org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }}
          model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
          refLabel={refLabelOf(ref, branchLabel)}
          segments={segments}
        />
        <div className={styles.header}>
          <Text as="h1" size="2xl">
            Landscape{capability ? `: systems supporting ${capability.name}` : ''}
          </Text>
          {state.status === 'ready' && (
            <div className={styles.actions}>
              {canAdd && (
                <>
                  <ElementSearchAdd
                    elementType="system"
                    buttonLabel="+ Add system"
                    parentId={null}
                    modelId={model.id}
                    orgId={organisation?.id ?? ''}
                    userId={userId}
                    searchCommitId={searchCommitId}
                    branch={editingBranch}
                    expectedHeadCommitId={writeHeadCommitId}
                    orgSlug={organisation?.slug ?? ''}
                    modelSlug={model.slug}
                    refParam={refParam}
                  />
                  <ElementSearchAdd
                    elementType="actor"
                    buttonLabel="+ Add actor"
                    parentId={null}
                    modelId={model.id}
                    orgId={organisation?.id ?? ''}
                    userId={userId}
                    searchCommitId={searchCommitId}
                    branch={editingBranch}
                    expectedHeadCommitId={writeHeadCommitId}
                    orgSlug={organisation?.slug ?? ''}
                    modelSlug={model.slug}
                    refParam={refParam}
                  />
                </>
              )}
              <Button variant="ghost" onClick={resetLayout}>
                Reset layout
              </Button>
            </div>
          )}
        </div>

        {ref.kind === 'branch' && (
          <BranchViewModeControl
            mode={mode}
            onChange={(next) => {
              setSearchParams((prev) => {
                const updated = new URLSearchParams(prev);
                updated.set('mode', next);
                return updated;
              });
            }}
          />
        )}
        {ref.kind === 'branch' && mode === 'diff' && <DiffLegend />}

        {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {state.status === 'error' && <Text as="p">{state.message}</Text>}
        {state.status === 'refNotFound' && <Text as="p">This model has no commits yet at this ref.</Text>}
        {state.status === 'ready' && state.data.layout.nodes.length === 0 && (
          <div>
            <EmptyState>{capability ? 'No systems support this capability yet.' : 'No systems yet.'}</EmptyState>
            {!capability && canAdd && (
              <div className={styles.actions}>
                <ElementSearchAdd
                  elementType="system"
                  buttonLabel="Add a system"
                  parentId={null}
                  modelId={model.id}
                  orgId={organisation?.id ?? ''}
                  userId={userId}
                  searchCommitId={searchCommitId}
                  branch={editingBranch}
                  expectedHeadCommitId={writeHeadCommitId}
                  orgSlug={organisation?.slug ?? ''}
                  modelSlug={model.slug}
                  refParam={refParam}
                />
              </div>
            )}
          </div>
        )}
        {state.status === 'ready' && state.data.layout.nodes.length > 0 && (
          <LandscapeCanvas layout={state.data.layout} systemsById={state.data.systemsById} edges={state.data.edges} diff={state.data.diff} nodeHref={nodeHref} />
        )}
        </main>
      </div>
    </div>
  );
}
