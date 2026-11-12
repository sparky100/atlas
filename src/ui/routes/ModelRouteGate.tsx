import { Link, Outlet, useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Loading } from '../components/Loading/Loading';
import { Text } from '../components/Text/Text';
import { useModels } from '../models/useModels';
import { StaleAfterMonthsContext } from '../orgs/staleThresholdContext';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';

/**
 * Wraps every `/o/:orgSlug/m/:modelSlug/...` route. A shared link can name
 * an organisation or model the recipient cannot see (RLS returns nothing
 * for a non-member, the same as for one that does not exist). Every page
 * used to show a spinner forever in that case; this gate shows one plain
 * explanation instead, once, for all of them. When the organisation and
 * model do resolve it renders the page untouched, so no page changes.
 * Both lookups share the query cache the pages themselves use.
 */
export function ModelRouteGate() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const { organisation, loading: orgLoading, error: orgError } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading, error: modelsError } = useModels(organisation?.id ?? null);

  if (orgLoading || (organisation && modelsLoading)) {
    return (
      <div style={{ padding: 'var(--space-8)' }}>
        <Loading />
      </div>
    );
  }

  const failed = orgError !== null || modelsError !== null;
  const missing = !organisation || !models.some((m) => m.slug === modelSlug);
  if (organisation && !failed && !missing) {
    return (
      <StaleAfterMonthsContext.Provider value={organisation.stale_after_months}>
        <Outlet />
      </StaleAfterMonthsContext.Provider>
    );
  }

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <main style={{ padding: 'var(--space-8)', maxWidth: '40rem' }}>
        <Text as="h1" size="lg">
          {failed ? "This page couldn't load" : "You can't open this link"}
        </Text>
        <Text as="p" tone="muted">
          {failed
            ? 'Something went wrong loading this page. Try again in a moment.'
            : "Either you aren't a member of this organisation, or what the link points to has been removed. Ask the person who sent it to check that you've been invited."}
        </Text>
        <Text as="p">
          <Link to="/">Go to Home</Link>
        </Text>
      </main>
    </div>
  );
}
