import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ElementBrowseTable } from '../components/ElementBrowseTable/ElementBrowseTable';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { useElementBrowse } from '../elements/useElementBrowse';
import styles from './ElementsPage.module.css';

/**
 * The element browse table's route (Sprint U3b) — "reachable from both
 * doors": `ModelHome.tsx` links here, and this page itself always reads
 * `main` (browsing is a director/architect-door affordance, not a
 * branch-scoped view; open an element from here to edit it at whatever
 * ref that page supports).
 */
export function ElementsPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const state = useElementBrowse(model?.id ?? '');

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
          <Breadcrumb
            org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }}
            model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
            refLabel="main"
          />
          <Text as="h1" size="2xl">
            Elements
          </Text>
          <ElementBrowseTable state={state} orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} />
        </main>
      </div>
    </div>
  );
}
