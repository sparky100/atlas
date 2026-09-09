import { useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useMainBranch } from '../branches/useMainBranch';
import { useModels } from '../models/useModels';
import { canEditOnMain, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { parseRefParam, refLabelOf, refParamOf } from '../../db/ref';
import { CapabilityMapImportPanel } from '../capabilityMap/CapabilityMapImportPanel';
import { CapabilityMapView } from '../capabilityMap/CapabilityMapView';
import { SyncDescriptionsAction } from '../capabilityMap/SyncDescriptionsAction';
import { useCapabilityMap } from '../capabilityMap/useCapabilityMap';
import styles from './CapabilityMapPage.module.css';

/**
 * The capability map (UI-principles §6.1, §3.1 — Sprint U2 step 1): the
 * model's own capability elements, nested by nothing more than
 * `parent_id`. This is the zoom chain's first stop (§2.1): every tile's
 * supporting-system count is also a link into the landscape filtered to
 * exactly those systems (Sprint U2 step 3 — see CapabilityMapView.tsx's
 * own comment); from there, Context, Container and Component are the
 * remaining four levels.
 *
 * Sprint U2 step 2's tailoring flow lives here too: `refNotFound` (an
 * unknown tag or branch ref — never main any more, since ADR-018 gives
 * every model's main branch a real genesis commit the instant it's
 * created) still gets the import panel for that case. The empty-map
 * moment that matters in practice — main resolves fine but has no
 * capabilities yet — is `ready` with an empty tree: the import panel
 * (seed from a starter map, the primary action once any map is published)
 * and "Add a capability" (CapabilityMapView's own empty-state branch, the
 * always-available fallback) both show there, owner/architect only, same
 * gate as `Edit` (ADR-015).
 */
export function CapabilityMapPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const [searchParams] = useSearchParams();
  const ref = parseRefParam(searchParams.get('ref'));
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const canEdit = ref.kind === 'main' && canEditOnMain(role);
  const { branch: mainBranch } = useMainBranch(model?.id ?? null);

  const { state, reload } = useCapabilityMap(model?.id ?? '', organisation?.id ?? '', userId, ref);

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

  const refParam = refParamOf(ref);

  return (
    <div>
      <AppHeader />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
        <Breadcrumb
          org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }}
          model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
          refLabel={refLabelOf(ref)}
        />
        <div className={styles.header}>
          <Text as="h1" size="2xl">
            Capability map
          </Text>
        </div>

        {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {state.status === 'error' && <Text as="p">{state.message}</Text>}
        {state.status === 'refNotFound' && canEdit && <CapabilityMapImportPanel modelId={model.id} userId={userId} onImported={reload} />}
        {state.status === 'refNotFound' && !canEdit && <Text as="p">This model has no commits yet at this ref.</Text>}
        {state.status === 'ready' && state.data.tree.l1.length === 0 && state.data.tree.orphans.length === 0 && canEdit && (
          <CapabilityMapImportPanel modelId={model.id} userId={userId} onImported={reload} />
        )}
        {state.status === 'ready' && (state.data.tree.l1.length > 0 || state.data.tree.orphans.length > 0) && canEdit && (
          <SyncDescriptionsAction modelId={model.id} userId={userId} onSynced={reload} />
        )}
        {state.status === 'ready' && (
          <CapabilityMapView
            tree={state.data.tree}
            supportsEdges={state.data.supportsEdges}
            systemsById={state.data.systemsById}
            orgSlug={organisation?.slug ?? ''}
            modelSlug={model.slug}
            refParam={refParam}
            addCapability={
              canEdit && mainBranch ? { modelId: model.id, orgId: organisation?.id ?? '', userId, branch: mainBranch, expectedHeadCommitId: state.data.commitId, onCreated: reload } : undefined
            }
            reorderCapability={
              canEdit && mainBranch ? { modelId: model.id, orgId: organisation?.id ?? '', userId, branch: mainBranch, expectedHeadCommitId: state.data.commitId, onReordered: reload } : undefined
            }
          />
        )}
        </main>
      </div>
    </div>
  );
}
