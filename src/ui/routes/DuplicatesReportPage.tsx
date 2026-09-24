import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
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
 * (`/duplicates`) — same "real route, reached only by a link, not one of
 * `ModelNav`'s fixed seven rail entries" precedent `BoundaryCrossingsPage.tsx`/
 * `ExternalInterfacesPage.tsx` already establish (`modelNavSection.ts`'s own
 * `modelNavSectionFor` has no case for this path, so no rail item lights up
 * here — deliberate, not an oversight). Not scoped to one ref, same as
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
          <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel={refLabelOf(ref, branchLabel)} />
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              Duplicates report
            </Text>
          </div>
          <DuplicatesReportView modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} searchCommitId={mainBranch.head_commit_id} duplicatesCheckEnabled={model.duplicates_check_enabled} role={role} />
        </main>
      </div>
    </div>
  );
}
