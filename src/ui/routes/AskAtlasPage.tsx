import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { AskAtlasView } from '../ask/AskAtlasView';
import { useAuth } from '../auth/useAuth';
import { useModels } from '../models/useModels';
import { useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ViewPage.module.css';

/** ADR-028 §8 (F15 step 4): `/ask`, under Analyse. Same chrome as the other model pages. */
export function AskAtlasPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const { userId } = useAuth();
  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          {model && <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel="Ask Atlas" />}
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              Ask Atlas
            </Text>
          </div>
          {orgLoading || modelsLoading || !organisation ? (
            <Text tone="muted">Loading…</Text>
          ) : !model ? (
            <Text as="p">This model doesn't exist, or you can't see it.</Text>
          ) : (
            <AskAtlasView modelId={model.id} basePath={`/o/${orgSlug ?? ''}/m/${model.slug}`} orgSlug={orgSlug ?? ''} enabled={organisation.ai_assistant_enabled} isOwner={role === 'owner'} />
          )}
        </main>
      </div>
    </div>
  );
}
