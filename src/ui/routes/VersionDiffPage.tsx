import { useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { Text } from '../components/Text/Text';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { parseRefParam, refLabelOf, refParamOf } from '../../db/ref';
import { VersionDiffView } from '../versions/VersionDiffView';
import { useVersionDiff } from '../versions/useVersionDiff';
import styles from './ViewPage.module.css';

/**
 * The version diff (Sprint U2 step 4, UI-principles §6.2): `?ref=` is
 * to-be, `?diff=` is as-is — the same convention §6.2 already names for a
 * branch's own As-is/To-be/Diff toggle (`?ref=tag:v2026-Q2&diff=tag:v2026-Q1`),
 * reused here for two arbitrary tags rather than a branch against main.
 */
export function VersionDiffPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const [searchParams] = useSearchParams();
  const toBe = parseRefParam(searchParams.get('ref'));
  const asIs = parseRefParam(searchParams.get('diff'));

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);

  const state = useVersionDiff(model?.id ?? '', toBe, asIs);

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
        <Breadcrumb
          org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }}
          model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
          refLabel={`${refLabelOf(asIs)} → ${refLabelOf(toBe)}`}
        />
        <div className={styles.header}>
          <Text as="h1" size="2xl">
            Diff: {refLabelOf(asIs)} → {refLabelOf(toBe)}
          </Text>
        </div>

        {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {state.status === 'error' && <Text as="p">{state.message}</Text>}
        {state.status === 'refNotFound' && <Text as="p">One of these versions could not be found.</Text>}
        {state.status === 'ready' && <VersionDiffView diff={state.data.diff} orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} toBeRefParam={refParamOf(toBe)} asIsRefParam={refParamOf(asIs)} />}
      </main>
    </div>
  );
}
