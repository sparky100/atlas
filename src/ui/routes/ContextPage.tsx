import { useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb, type BreadcrumbSegment } from '../components/Breadcrumb/Breadcrumb';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { refLabelOf, refParamOf } from '../../db/ref';
import { parseViewMode } from '../../db/viewMode';
import { BranchViewModeControl } from '../branches/BranchViewModeControl';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useSelectedRef } from '../branches/useSelectedRef';
import { ContextView } from '../context/ContextView';
import { useSystemContext } from '../context/useSystemContext';
import { parseCapabilityParam } from '../nav/zoomParams';
import { useBreadcrumbElement } from '../nav/useBreadcrumbElement';
import styles from './ViewPage.module.css';

/**
 * The Context view route (UI-principles §6.1/§2.1 — Sprint U2 step 3): one
 * system, everything it connects to. The zoom chain's third stop
 * (capability → landscape → **context** → containers → components).
 *
 * Check D1: `<main>` escapes the page's usual centred max-width once
 * there's real content (`ViewPage.module.css`'s own `.mainWithView`
 * comment has the full reasoning, shared with Container/Component).
 */
export function ContextPage() {
  const { orgSlug, modelSlug, systemId } = useParams<{ orgSlug: string; modelSlug: string; systemId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { ref } = useSelectedRef();
  const mode = parseViewMode(searchParams.get('mode'));
  const capabilityId = parseCapabilityParam(searchParams.get('capability'));
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const capability = useBreadcrumbElement(model?.id ?? null, ref, capabilityId);
  const { label: branchLabel } = useBranchLabel(ref);

  const state = useSystemContext(model?.id ?? '', organisation?.id ?? '', userId, systemId ?? '', ref, mode);

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
  const segments: BreadcrumbSegment[] = [];
  if (capability) segments.push({ label: capability.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}/capability-map?ref=${refParam}` });
  if (state.status === 'ready') segments.push({ label: state.data.group.hub.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}/context/${systemId ?? ''}?ref=${refParam}` });

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
            Context
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
        {state.status === 'ready' && <ContextView group={state.data.group} orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} refParam={refParam} diff={state.data.diff} />}
        </main>
      </div>
    </div>
  );
}
