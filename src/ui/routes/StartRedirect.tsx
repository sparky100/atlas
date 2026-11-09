import { Navigate, useParams } from 'react-router';
import { resolveStartPage } from '../../contracts/userPreferences';
import { useAuth } from '../auth/useAuth';
import { Loading } from '../components/Loading/Loading';
import { useModels } from '../models/useModels';
import { useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { START_PAGE_PATHS } from '../profile/startPageLabels';
import { useStartPage } from '../profile/useStartPage';

/**
 * `/o/:org/m/:model/start` — where the model list sends you when you open a model: straight to your own start page (a saved choice, else Home for owners and architects and the capability map for everyone else). Home itself, and every other page, still has its own address, so bookmarks and the Home item in the nav are unaffected.
 */
export function StartRedirect() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const { userId } = useAuth();
  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const { role, loading: roleLoading } = useMembership(organisation?.id ?? null, userId);
  const { saved, loading: startLoading } = useStartPage(userId);
  const model = models.find((m) => m.slug === modelSlug);

  if (orgLoading || modelsLoading || roleLoading || startLoading || !model) return <Loading />;
  const page = resolveStartPage(saved, role === 'owner' || role === 'architect');
  return <Navigate to={`/o/${orgSlug ?? ''}/m/${model.slug}${START_PAGE_PATHS[page]}`} replace />;
}
