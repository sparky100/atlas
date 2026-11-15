import { Loading } from '../components/Loading/Loading';
import { ModelEmptyState } from '../components/EmptyState/ModelEmptyState';
import { useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { PageIntro } from '../components/PageIntro/PageIntro';
import { Text } from '../components/Text/Text';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { ViewingBranchBanner } from '../branches/ViewingBranchBanner/ViewingBranchBanner';
import { hintedModelId, useMainBranch } from '../branches/useMainBranch';
import { useSelectedRef } from '../branches/useSelectedRef';
import { isViewingMode } from '../branches/viewingMode';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { refLabelOf, refQueryParam } from '../../db/ref';
import { IntegrationsView } from '../integrations/IntegrationsView';
import { useIntegrations } from '../integrations/useIntegrations';
import styles from './IntegrationsPage.module.css';

/**
 * Every system-to-system link in the model (`uses`/`flows_to`), direct or
 * through an integration platform, with the managing platform first on each
 * row (ADR-026). Same model-level route chrome as `PortfolioPage.tsx`.
 * Derived-only: no `views`/`view_layouts` row — a plain table, not a diagram.
 */
export function IntegrationsPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const [searchParams] = useSearchParams();
  const { ref } = useSelectedRef();
  const viewing = isViewingMode(searchParams);

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { branch: mainBranch, loading: mainBranchLoading } = useMainBranch(model?.id ?? null);

  const { state } = useIntegrations(hintedModelId(model?.id, ref, mainBranchLoading) ?? '', ref, mainBranch?.head_commit_id ?? null);

  if (orgLoading || modelsLoading || !model) {
    return (
      <div>
        <AppHeader orgId={organisation?.id ?? null} />
        <div className={navStyles.body}>
          <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
          <main className={styles.main}>
            <Loading />
          </main>
        </div>
      </div>
    );
  }

  const refParam = refQueryParam(ref, viewing);
  const elementHref = (elementId: string) => `/o/${orgSlug ?? ''}/m/${model.slug}/e/${elementId}?${refParam}`;

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          {viewing ? <ViewingBranchBanner activeRef={ref} /> : <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} showModeShortcuts={false} />}
          <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel={refLabelOf(ref)} />
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              Integrations
            </Text>
          </div>
          <PageIntro>How systems connect to each other, and the platforms and interfaces they go through.</PageIntro>

          {state.status === 'loading' && <Loading />}
          {state.status === 'error' && <Text as="p">{state.message}</Text>}
          {state.status === 'refNotFound' && <ModelEmptyState orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />}
          {state.status === 'ready' && <IntegrationsView data={state.data} elementHref={elementHref} />}
        </main>
      </div>
    </div>
  );
}
