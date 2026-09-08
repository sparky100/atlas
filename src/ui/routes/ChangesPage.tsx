import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { ChangesView } from '../changes/ChangesView';
import { useAuth } from '../auth/useAuth';
import { useModels } from '../models/useModels';
import { canCreateChangeBranch, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ViewPage.module.css';

/**
 * The changes list (Sprint C1 step 3, UI-principles §2.4's `/changes`
 * route): create a change branch (name, description, target date) and see
 * every change on this model. Like VersionsPage, this list isn't scoped to
 * one ref — it's read from `branches` directly — so the breadcrumb's ref
 * chip reads `main`.
 */
export function ChangesPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const canCreate = canCreateChangeBranch(role);

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

  return (
    <div>
      <AppHeader />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel="main" />
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              Changes
            </Text>
          </div>
          <ChangesView modelId={model.id} orgId={organisation?.id ?? ''} userId={userId} orgSlug={orgSlug ?? ''} modelSlug={model.slug} canCreate={canCreate} />
        </main>
      </div>
    </div>
  );
}
