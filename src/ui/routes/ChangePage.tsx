import { Loading } from '../components/Loading/Loading';
import { Link, useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { Button } from '../components/Button/Button';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { ChangeOrigin } from '../changes/ChangeOrigin';
import { ChangeView } from '../changes/ChangeView';
import { intentHeaderLine } from '../changes/branchIntent';
import { ChangeProjectAssignment } from '../projects/ChangeProjectAssignment';
import { useChange } from '../changes/useChange';
import { useAuth } from '../auth/useAuth';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { ViewingBranchBanner } from '../branches/ViewingBranchBanner/ViewingBranchBanner';
import { useSelectedRef } from '../branches/useSelectedRef';
import { isViewingMode } from '../branches/viewingMode';
import { useModels } from '../models/useModels';
import { canCreateChangeBranch, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { refQueryParam } from '../../db/ref';
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
 *
 * S1 item 2: "View this change" sits beside it — the other, read-only
 * half of the same choice ("distinct from 'Work in this change'"). Unlike
 * "Edit in this change" it never calls `setRef` (nothing about the
 * session's own selection changes), is available at *every* branch
 * status (a reviewer views an approved or merged change too, not just a
 * draft one) and needs no role check (a viewer sees everything read-only
 * by design — same reasoning `ElementPage.tsx`'s own `underReview` gate
 * comment gives `canCreateChangeBranch`, just with no gate here at all).
 * A plain link to Landscape at this branch's ref with `viewing=1`
 * (`refQueryParam`) — Landscape is this change's own natural "To-be"
 * view, the same first stop `"Edit in this change"` implicitly assumes
 * too (nothing on *this* page itself needs a read-only mode; it already
 * has none of Landscape/CapabilityMap/ElementPage's own edit affordances
 * to hide).
 */
export function ChangePage() {
  const { orgSlug, modelSlug, branchId } = useParams<{ orgSlug: string; modelSlug: string; branchId: string }>();
  const [searchParams] = useSearchParams();
  const { userId } = useAuth();
  const { ref, setRef } = useSelectedRef();
  const viewing = isViewingMode(searchParams);

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const canEdit = canCreateChangeBranch(role);
  const { branch, reload: reloadBranch } = useChange(branchId ?? '');
  const isSelected = ref.kind === 'branch' && ref.branchId === branchId;

  if (orgLoading || modelsLoading || !model) {
    return (
      <div>
        <AppHeader orgId={organisation?.id ?? null} />
        <div className={navStyles.body}>
          <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
          <main className={styles.main}>
            <Loading />
          </main>
        </div>
      </div>
    );
  }

  const refLabel = branch ? `Change: ${branch.title ?? branch.name}` : 'Change';

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          {/* Own page already has its own "Submit for review" (below, via ChangeView) — the banner's copy of that action exists for every *other* page; showing both here would be the literal duplicate this item's own comment warns against. */}
          {viewing ? (
            <ViewingBranchBanner activeRef={ref} />
          ) : (
            <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} showModeShortcuts={false} showSubmitForReview={false} />
          )}
          <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel={refLabel} />
          <div className={styles.headerRow}>
            <Text as="h1" size="2xl">
              {/* Prompt pack F0: the header line names the change's own
                  "why" (Recording:/Proposing:/Correction/Exploring:) — see
                  `branchIntent.ts`'s own doc comment for the exact four
                  sentences and why `correct` gets no title suffix. Falls
                  back to the plain title/name this page always showed
                  before F0 (a `null` branch — still loading — or an
                  `intent` of `null`, which is real only for a change
                  branch created before this migration existed). */}
              {branch ? intentHeaderLine(branch) : 'Change'}
            </Text>
            {branchId && (
              <div className={styles.headerActions}>
                {canEdit && branch?.status === 'draft' && (
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
                <Link to={`/o/${orgSlug ?? ''}/m/${model.slug}/landscape?${refQueryParam({ kind: 'branch', branchId }, true)}`}>
                  <Button variant="secondary">View this change</Button>
                </Link>
              </div>
            )}
          </div>
          {branch && <ChangeOrigin branch={branch} orgSlug={orgSlug ?? ''} modelSlug={model.slug} />}
          {branch && <ChangeProjectAssignment branch={branch} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} canEdit={canEdit} onMoved={reloadBranch} />}
          <ChangeView orgId={organisation?.id ?? ''} modelId={model.id} branchId={branchId ?? ''} orgSlug={orgSlug ?? ''} modelSlug={model.slug} role={role} canEdit={canEdit} />
        </main>
      </div>
    </div>
  );
}
