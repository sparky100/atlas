import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { Text } from '../components/Text/Text';
import { ReviewRequestView } from '../reviews/ReviewRequestView';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ViewPage.module.css';

/** A single review request's page (Sprint C1 step 7, UI-principles §2.4's `/review/{mergeRequestId}` route). */
export function ReviewRequestPage() {
  const { orgSlug, modelSlug, mergeRequestId } = useParams<{ orgSlug: string; modelSlug: string; mergeRequestId: string }>();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);

  if (orgLoading || modelsLoading || !model || !organisation) {
    return (
      <div>
        <AppHeader />
        <main className={styles.main}>
          <Text tone="muted">Loading…</Text>
        </main>
      </div>
    );
  }

  return (
    <div>
      <AppHeader />
      <main className={styles.main}>
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
  );
}
