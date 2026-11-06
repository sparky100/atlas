import { useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { ViewingBranchBanner } from '../branches/ViewingBranchBanner/ViewingBranchBanner';
import { hintedModelId, useMainBranch } from '../branches/useMainBranch';
import { useSelectedRef } from '../branches/useSelectedRef';
import { isViewingMode } from '../branches/viewingMode';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { refLabelOf, refQueryParam } from '../../db/ref';
import { PortfolioView } from '../portfolio/PortfolioView';
import { usePortfolio } from '../portfolio/usePortfolio';
import { useBranchLabel } from '../branches/useBranchLabel';
import { exportDate, stampRefLabel } from '../exports/viewExport';
import { useAuth } from '../auth/useAuth';
import { useMembership } from '../orgs/useMembership';
import styles from './PortfolioPage.module.css';

/**
 * The Portfolio view (task: "a sortable list of systems and platforms
 * showing run cost against fit, criticality, lifecycle and capabilities
 * served, with computed signals for the combinations that matter"). Same
 * model-level route chrome as `RoadmapPage.tsx`/`ValueStreamsPage.tsx`
 * (`AppHeader` → `ModelNav` → `main` with the editing/viewing branch banner
 * → `Breadcrumb` → content). Derived-only: no `views`/`view_layouts` row
 * (ADR-011 doesn't apply — this is a plain table, not a diagram), no
 * findings, not on Home this sprint — exactly the task's own stated scope.
 */
export function PortfolioPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const [searchParams] = useSearchParams();
  const { ref } = useSelectedRef();
  const viewing = isViewingMode(searchParams);

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { branch: mainBranch, loading: mainBranchLoading } = useMainBranch(model?.id ?? null);
  const { userId } = useAuth();
  const { role } = useMembership(organisation?.id ?? null, userId);

  const { state } = usePortfolio(hintedModelId(model?.id, ref, mainBranchLoading) ?? '', ref, mainBranch?.head_commit_id ?? null);
  const { label: branchLabel } = useBranchLabel(ref);

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
              Portfolio
            </Text>
          </div>

          {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
          {state.status === 'error' && <Text as="p">{state.message}</Text>}
          {state.status === 'refNotFound' && <Text as="p">Nothing here yet.</Text>}
          {state.status === 'ready' && <PortfolioView data={state.data} elementHref={elementHref} savedReports={organisation ? { modelId: model.id, orgId: organisation.id, userId, role } : undefined} exportStamp={{ modelName: model.name, refLabel: stampRefLabel(ref, branchLabel), date: exportDate() }} />}
        </main>
      </div>
    </div>
  );
}
