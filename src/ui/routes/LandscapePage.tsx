import { useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Button } from '../components/Button/Button';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { parseRefParam } from '../../db/ref';
import { LandscapeCanvas } from '../landscape/LandscapeCanvas';
import { useLandscape } from '../landscape/useLandscape';
import styles from './LandscapePage.module.css';

/**
 * The Landscape view (UI-principles.md §6.1, Sprint U1 step 4a): systems in
 * swim-lanes by the capability they support, `uses`/`flows_to` edges
 * between them. Context/Container/Component views reuse the same renderer
 * with a different query and layout preset in a later step; capability map
 * is Sprint U2 (§6.1's amendment). No Web Worker, viewport culling, LOD, or
 * diff/annotations UI yet — step 4b and later steps, named not skipped.
 */
export function LandscapePage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const [searchParams] = useSearchParams();
  const ref = parseRefParam(searchParams.get('ref'));
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);

  const { state, resetLayout } = useLandscape(model?.id ?? '', organisation?.id ?? '', userId, ref);

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
        <div className={styles.header}>
          <Text as="h1" size="2xl">
            Landscape
          </Text>
          {state.status === 'ready' && (
            <div className={styles.actions}>
              <Button variant="ghost" onClick={resetLayout}>
                Reset layout
              </Button>
            </div>
          )}
        </div>

        {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {state.status === 'error' && <Text as="p">{state.message}</Text>}
        {state.status === 'refNotFound' && <Text as="p">This model has no commits yet at this ref.</Text>}
        {state.status === 'ready' && state.data.layout.nodes.length === 0 && <EmptyState>No systems yet. Add a System from the element page to see it here.</EmptyState>}
        {state.status === 'ready' && state.data.layout.nodes.length > 0 && (
          <LandscapeCanvas layout={state.data.layout} systemsById={state.data.systemsById} edges={state.data.edges} orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} />
        )}
      </main>
    </div>
  );
}
