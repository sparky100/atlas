import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { Button } from '../components/Button/Button';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { ChangeView } from '../changes/ChangeView';
import { useChange } from '../changes/useChange';
import { useAuth } from '../auth/useAuth';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { useSelectedRef } from '../branches/useSelectedRef';
import { useModels } from '../models/useModels';
import { canCreateChangeBranch, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ViewPage.module.css';

/**
 * A single change's page (Sprint C1 step 3, UI-principles §2.4's
 * `/changes/{branchSlug}` route, routed on the branch id — see
 * ChangeView's own comment on why). The breadcrumb's `[ref]` chip reads
 * `Change: {title}` exactly as §2.2 specifies for a branch ref — this is
 * this page's own label, independent of whether the change is the
 * session's actual selected ref (`useSelectedRef`); "Edit in this
 * change" below is the explicit action that makes it so.
 *
 * Bug fix: "opening a change" (viewing this page) never itself selected
 * it — nothing on this page called `setRef`, so there was no way to
 * start editing in a change from here at all, and every subsequent
 * create/edit action anywhere else in the app stayed on whatever ref it
 * already had (usually main). "Edit in this change" is that missing
 * action: it selects this branch as the session's ref (persisted per
 * model, `SelectedRefProvider.tsx`), after which every other page — the
 * nav rail, the breadcrumb, search, create/edit — carries it forward.
 * Only offered for a `draft` branch (`useMembership.ts`'s own
 * `canEditBranch`: the only status a change branch is actually
 * committable to).
 */
export function ChangePage() {
  const { orgSlug, modelSlug, branchId } = useParams<{ orgSlug: string; modelSlug: string; branchId: string }>();
  const { userId } = useAuth();
  const { ref, setRef } = useSelectedRef();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const canEdit = canCreateChangeBranch(role);
  const { branch } = useChange(branchId ?? '');
  const isSelected = ref.kind === 'branch' && ref.branchId === branchId;

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

  const refLabel = branch ? `Change: ${branch.title ?? branch.name}` : 'Change';

  return (
    <div>
      <AppHeader />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          <EditingBranchBanner activeRef={ref} showModeShortcuts={false} />
          <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel={refLabel} />
          <div className={styles.headerRow}>
            <Text as="h1" size="2xl">
              {branch?.title ?? branch?.name ?? 'Change'}
            </Text>
            {canEdit && branch?.status === 'draft' && branchId && (
              <Button
                variant={isSelected ? 'ghost' : 'primary'}
                disabled={isSelected}
                onClick={() => {
                  setRef({ kind: 'branch', branchId });
                }}
              >
                {isSelected ? 'Editing in this change' : 'Edit in this change'}
              </Button>
            )}
          </div>
          <ChangeView orgId={organisation?.id ?? ''} modelId={model.id} branchId={branchId ?? ''} orgSlug={orgSlug ?? ''} modelSlug={model.slug} role={role} canEdit={canEdit} />
        </main>
      </div>
    </div>
  );
}
