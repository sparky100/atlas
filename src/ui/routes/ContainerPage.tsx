import { useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb, type BreadcrumbSegment } from '../components/Breadcrumb/Breadcrumb';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { parseRefParam, refLabelOf, refParamOf } from '../../db/ref';
import { parseViewMode } from '../../db/viewMode';
import { BranchViewModeControl } from '../branches/BranchViewModeControl';
import { useBranchLabel } from '../branches/useBranchLabel';
import { StructureView } from '../structureView/StructureView';
import { useStructureView } from '../structureView/useStructureView';
import { parseCapabilityParam } from '../nav/zoomParams';
import { useBreadcrumbElement } from '../nav/useBreadcrumbElement';
import styles from './ViewPage.module.css';

/**
 * The Container view route (UI-principles §6.1/§2.1 — Sprint U2 step 3):
 * one system's containers. The zoom chain's fourth stop (capability →
 * landscape → context → **containers** → components).
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
  const capability = useBreadcrumbElement(model?.id ?? '', ref, capabilityId);
  const { label: branchLabel } = useBranchLabel(ref);

  const state = useStructureView('container', model?.id ?? '', organisation?.id ?? '', userId, systemId ?? '', ref, mode);

  if (orgLoading || modelsLoading || !model) {
    return (
      <div>
        <AppHeader />
        <main className={styles.main}>
          <Text tone="muted">Loading…</Text>
        </main>
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
      <main className={styles.main}>
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
        {state.status === 'ready' && <StructureView kind="container" group={state.data.group} orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} refParam={refParam} diff={state.data.diff} />}
      </main>
    </div>
  );
}
