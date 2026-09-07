import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { Text } from '../components/Text/Text';
import { ReviewQueueView } from '../reviews/ReviewQueueView';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ViewPage.module.css';

/** The review queue's list (Sprint C1 step 7, UI-principles §2.4's `/review` route). */
export function ReviewQueuePage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);

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

  return (
    <div>
      <AppHeader />
      <main className={styles.main}>
        <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel="Review queue" />
        <div className={styles.header}>
          <Text as="h1" size="2xl">
            Review queue
          </Text>
        </div>
        <ReviewQueueView modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} />
      </main>
    </div>
  );
}
