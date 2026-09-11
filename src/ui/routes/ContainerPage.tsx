import { useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb, type BreadcrumbSegment } from '../components/Breadcrumb/Breadcrumb';
import { ElementSearchAdd } from '../components/ElementSearchAdd/ElementSearchAdd';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useModels } from '../models/useModels';
import { canEditBranch, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { parseRefParam, refLabelOf, refParamOf } from '../../db/ref';
import { parseViewMode } from '../../db/viewMode';
import { BranchViewModeControl } from '../branches/BranchViewModeControl';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useEditingBranch } from '../branches/useEditingBranch';
import { useMainBranch } from '../branches/useMainBranch';
import { StructureView } from '../structureView/StructureView';
import { useStructureView } from '../structureView/useStructureView';
import { parseCapabilityParam } from '../nav/zoomParams';
import { useBreadcrumbElement } from '../nav/useBreadcrumbElement';
import styles from './ViewPage.module.css';

/**
 * The Container view route (UI-principles §6.1/§2.1 — Sprint U2 step 3):
 * one system's containers. The zoom chain's fourth stop (capability →
 * landscape → context → **containers** → components).
 *
 * Blocking: element creation's search-first "Add" control lives here for
 * containers (parented on this page's own `systemId`) — the brief's "on a
 * system's context page for containers" read against this page rather than
 * ContextPage.tsx, which shows a system's neighbouring systems, not its
 * containers (`Containers →` on ContextView.tsx links here).
 *
 * Check D1: `<main>` escapes the page's usual centred max-width once
 * there's real content — `ViewPage.module.css`'s own `.mainWithView`
 * comment has the full reasoning, shared with Context/Component.
 */
export function ContainerPage() {
  const { orgSlug, modelSlug, systemId } = useParams<{ orgSlug: string; modelSlug: string; systemId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const ref = parseRefParam(searchParams.get('ref'));
  const mode = parseViewMode(searchParams.get('mode'));
  const capabilityId = parseCapabilityParam(searchParams.get('capability'));
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const capability = useBreadcrumbElement(model?.id ?? null, ref, capabilityId);
  const { label: branchLabel } = useBranchLabel(ref);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const { branch: editingBranch } = useEditingBranch(model?.id ?? null, ref);
  const { branch: mainBranch, reload: reloadMainBranch } = useMainBranch(model?.id ?? null);
  const canEdit = editingBranch !== null && canEditBranch(role, editingBranch);
  // See LandscapePage.tsx's identical comment: ADR-018 guarantees both are
  // never null in practice; BranchRow's own type hasn't been narrowed yet.
  const searchCommitId = mainBranch?.head_commit_id ?? null;
  const writeHeadCommitId = editingBranch?.head_commit_id ?? null;
  const canAdd = canEdit && searchCommitId !== null && writeHeadCommitId !== null;

  const state = useStructureView('container', model?.id ?? '', organisation?.id ?? '', userId, systemId ?? '', ref, mode);

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
  const contextHref = `/o/${orgSlug ?? ''}/m/${model.slug}/context/${systemId ?? ''}?${new URLSearchParams({ ref: refParam, ...(capabilityId ? { capability: capabilityId } : {}) }).toString()}`;
  const segments: BreadcrumbSegment[] = [];
  if (capability) segments.push({ label: capability.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}/capability-map?ref=${refParam}` });
  segments.push({ label: state.status === 'ready' ? state.data.group.parent.name : '…', href: contextHref });

  return (
    <div>
      <AppHeader />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={[styles.main, state.status === 'ready' ? styles.mainWithView : ''].filter(Boolean).join(' ')}>
        <EditingBranchBanner activeRef={ref} />
        <Breadcrumb
          org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }}
          model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
          refLabel={refLabelOf(ref, branchLabel)}
          segments={segments}
        />
        <div className={styles.header}>
          <Text as="h1" size="2xl">
            Containers
          </Text>
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

        {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {state.status === 'error' && <Text as="p">{state.message}</Text>}
        {state.status === 'refNotFound' && <Text as="p">This model has no commits yet at this ref.</Text>}
        {state.status === 'notPresentAtRef' && (
          <Panel>
            <Text as="p" tone="muted">
              This system is not present at the current ref. It may have been retracted, or never existed here.
            </Text>
          </Panel>
        )}
        {state.status === 'ready' && (
          <StructureView
            kind="container"
            group={state.data.group}
            orgSlug={organisation?.slug ?? ''}
            modelSlug={model.slug}
            refParam={refParam}
            diff={state.data.diff}
            addChild={
              canAdd ? (
                <ElementSearchAdd
                  elementType="container"
                  buttonLabel="+ Add container"
                  parentId={systemId ?? ''}
                  modelId={model.id}
                  orgId={organisation?.id ?? ''}
                  userId={userId}
                  searchCommitId={searchCommitId}
                  branch={editingBranch}
                  expectedHeadCommitId={writeHeadCommitId}
                  orgSlug={organisation?.slug ?? ''}
                  modelSlug={model.slug}
                  refParam={refParam}
                  onCreated={reloadMainBranch}
                />
              ) : undefined
            }
          />
        )}
        </main>
      </div>
    </div>
  );
}
