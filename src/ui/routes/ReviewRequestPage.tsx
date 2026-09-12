import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { ReviewRequestView } from '../reviews/ReviewRequestView';
import { useSelectedRef } from '../branches/useSelectedRef';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ViewPage.module.css';

/** A single review request's page (Sprint C1 step 7, UI-principles §2.4's `/review/{mergeRequestId}` route). */
export function ReviewRequestPage() {
  const { orgSlug, modelSlug, mergeRequestId } = useParams<{ orgSlug: string; modelSlug: string; mergeRequestId: string }>();
  const { ref } = useSelectedRef();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);

  if (orgLoading || modelsLoading || !model || !organisation) {
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
          <Breadcrumb
            org={{ label: organisation.name, href: `/o/${orgSlug ?? ''}` }}
            model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
            refLabel="Review queue"
            segments={[{ label: 'Review', href: `/o/${orgSlug ?? ''}/m/${model.slug}/review` }]}
          />
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              Review request
            </Text>
          </div>
          <ReviewRequestView modelId={model.id} mergeRequestId={mergeRequestId ?? ''} orgId={organisation.id} />
        </main>
      </div>
    </div>
  );
}
