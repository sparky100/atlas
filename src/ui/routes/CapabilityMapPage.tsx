import { useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { parseRefParam } from '../../db/ref';
import { CapabilityMapView } from '../capabilityMap/CapabilityMapView';
import { useCapabilityMap } from '../capabilityMap/useCapabilityMap';
import styles from './CapabilityMapPage.module.css';

/**
 * The capability map (UI-principles §6.1, §3.1 — Sprint U2 step 1): the
 * model's own capability elements, nested by nothing more than
 * `parent_id`. Context/container/component and the landscape were built
 * in Sprint U1; this is the first of the five view kinds to render
 * `capability_map`. No zoom into a landscape scoped to a tile's supporting
 * systems yet (that's this sprint's zoom-chain step); clicking a tile
 * today goes straight to its element page, same as every other view.
 */
export function CapabilityMapPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const [searchParams] = useSearchParams();
  const ref = parseRefParam(searchParams.get('ref'));
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);

  const state = useCapabilityMap(model?.id ?? '', organisation?.id ?? '', userId, ref);

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
            Capability map
          </Text>
        </div>

        {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {state.status === 'error' && <Text as="p">{state.message}</Text>}
        {state.status === 'refNotFound' && <Text as="p">This model has no commits yet at this ref.</Text>}
        {state.status === 'ready' && (
          <CapabilityMapView tree={state.data.tree} supportsEdges={state.data.supportsEdges} systemsById={state.data.systemsById} orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} />
        )}
      </main>
    </div>
  );
}
