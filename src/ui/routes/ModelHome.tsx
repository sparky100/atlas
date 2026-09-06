import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';

/**
 * Model home. Honest placeholder (CLAUDE.md rule 7): the two front doors,
 * the element page, and the landscape view are the product's actual
 * content and are named as later Sprint U1 steps in the brief — nothing
 * here fakes them. This step's job was proving the URL resolves to a real
 * model, through real auth and RLS.
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
              <Text as="p" tone="muted">
                The capability map, the element page, and the landscape view are not built yet — Sprint U1 steps 3 and 4.
              </Text>
            </Panel>
          </>
        )}
      </main>
    </div>
  );
}
