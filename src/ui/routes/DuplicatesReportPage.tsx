import { Loading } from '../components/Loading/Loading';
import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { PageIntro } from '../components/PageIntro/PageIntro';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useMainBranch } from '../branches/useMainBranch';
import { useSelectedRef } from '../branches/useSelectedRef';
import { refLabelOf } from '../../db/ref';
import { DuplicatesReportView } from '../duplicates/DuplicatesReportView';
import { useModels } from '../models/useModels';
import { useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ViewPage.module.css';

/**
 * F4 (ADR-019 "Amended (F4, ...)"): the duplicates report route
 * (`/duplicates`) — one of the reports the Reports hub lists (F9 step 3,
 * `ReportsPage.tsx`), alongside `BoundaryCrossingsPage.tsx`/
 * `ExternalInterfacesPage.tsx`; the nav's Reports item lights up here
 * (`modelNavSection.ts`). Before F9 these three had no nav entry and were
 * reached only by links. Not scoped to one ref, same as
 * Capture/Changes/Versions — the report always reads main's own current
 * head (ADR-019), never a change branch.
 */
export function DuplicatesReportPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const { userId } = useAuth();
  const { ref } = useSelectedRef();
  const { label: branchLabel } = useBranchLabel(ref);

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const { branch: mainBranch, loading: mainLoading } = useMainBranch(model?.id ?? null);

  if (orgLoading || modelsLoading || mainLoading || !model || !mainBranch) {
    return (
      <div>
        <AppHeader />
        <div className={navStyles.body}>
          <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
          <main className={styles.main}>
            <Loading />
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
          <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel={refLabelOf(ref, branchLabel)} />
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              Duplicates report
            </Text>
          </div>
          <PageIntro>Elements that look like the same thing recorded twice, so you can merge them.</PageIntro>
          <DuplicatesReportView modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} searchCommitId={mainBranch.head_commit_id} duplicatesCheckEnabled={model.duplicates_check_enabled} role={role} />
        </main>
      </div>
    </div>
  );
}
