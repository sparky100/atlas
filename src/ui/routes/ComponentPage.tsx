import { useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb, type BreadcrumbSegment } from '../components/Breadcrumb/Breadcrumb';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { parseRefParam, refLabelOf, refParamOf } from '../../db/ref';
import { StructureView } from '../structureView/StructureView';
import { useStructureView } from '../structureView/useStructureView';
import { parseCapabilityParam } from '../nav/zoomParams';
import { useBreadcrumbElement } from '../nav/useBreadcrumbElement';
import styles from './ViewPage.module.css';

/**
 * The Component view route (UI-principles §6.1/§2.1 — Sprint U2 step 3):
 * one container's components. The zoom chain's last stop (capability →
 * landscape → context → containers → **components**).
 */
export function ComponentPage() {
  const { orgSlug, modelSlug, containerId } = useParams<{ orgSlug: string; modelSlug: string; containerId: string }>();
  const [searchParams] = useSearchParams();
  const ref = parseRefParam(searchParams.get('ref'));
  const capabilityId = parseCapabilityParam(searchParams.get('capability'));
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const capability = useBreadcrumbElement(model?.id ?? '', ref, capabilityId);

  const state = useStructureView('component', model?.id ?? '', organisation?.id ?? '', userId, containerId ?? '', ref);
  const systemId = state.status === 'ready' ? state.data.group.parent.parent_id : null;
  const system = useBreadcrumbElement(model?.id ?? '', ref, systemId);

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
  const zoomQuery = new URLSearchParams({ ref: refParam, ...(capabilityId ? { capability: capabilityId } : {}) }).toString();
  const segments: BreadcrumbSegment[] = [];
  if (capability) segments.push({ label: capability.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}/capability-map?ref=${refParam}` });
  if (state.status === 'ready') {
    const container = state.data.group.parent;
    if (system) segments.push({ label: system.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}/context/${system.element_id}?${zoomQuery}` });
    segments.push({ label: container.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}/container/${systemId ?? ''}?${zoomQuery}` });
  }

  return (
    <div>
      <AppHeader />
      <main className={styles.main}>
        <Breadcrumb
          org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }}
          model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
          refLabel={refLabelOf(ref)}
          segments={segments}
        />
        <div className={styles.header}>
          <Text as="h1" size="2xl">
            Components
          </Text>
        </div>

        {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {state.status === 'error' && <Text as="p">{state.message}</Text>}
        {state.status === 'refNotFound' && <Text as="p">This model has no commits yet at this ref.</Text>}
        {state.status === 'notPresentAtRef' && (
          <Panel>
            <Text as="p" tone="muted">
              This container is not present at the current ref. It may have been retracted, or never existed here.
            </Text>
          </Panel>
        )}
        {state.status === 'ready' && <StructureView kind="component" group={state.data.group} orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} refParam={refParam} />}
      </main>
    </div>
  );
}
