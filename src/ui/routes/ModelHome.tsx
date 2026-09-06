import { Link, useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';

/**
 * Model home. Honest placeholder (CLAUDE.md rule 7) for what's still
 * missing: the two front doors (§3) and a way to browse into an individual
 * element from here aren't built yet. Landscape (Sprint U1 step 4a) and
 * the capability map (Sprint U2 step 1) are real now, so they're links,
 * not lines of "not built yet" prose.
 */
export function ModelHome() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);

  const loading = orgLoading || modelsLoading;

  return (
    <div>
      <AppHeader />
      <main style={{ padding: 'var(--space-8)', maxWidth: 640, margin: '0 auto' }}>
        {loading ? (
          <Text tone="muted">Loading…</Text>
        ) : !model ? (
          <Text as="p">{`No model found for "${modelSlug ?? ''}" in this organisation.`}</Text>
        ) : (
          <>
            <Text as="h1" size="2xl">
              {model.name}
            </Text>
            <Panel>
              <Text as="p">
                <Link to={`/o/${organisation?.slug ?? ''}/m/${model.slug}/capability-map`}>Capability map →</Link>
              </Text>
              <Text as="p">
                <Link to={`/o/${organisation?.slug ?? ''}/m/${model.slug}/landscape`}>Landscape →</Link>
              </Text>
              <Text as="p" tone="muted">
                A way to browse into an individual element from here is not built yet.
              </Text>
            </Panel>
          </>
        )}
      </main>
    </div>
  );
}
