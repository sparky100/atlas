import { useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { parseDecisionPrefillFromSearchParams } from '../decisions/decisionPrefill';
import { DecisionsView } from '../decisions/DecisionsView';
import { useAuth } from '../auth/useAuth';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useSelectedRef } from '../branches/useSelectedRef';
import { refLabelOf } from '../../db/ref';
import { useModels } from '../models/useModels';
import { canStartDecision, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ViewPage.module.css';

/**
 * The decisions list (prompt pack F3 PR4, `/decisions` route) — start a
 * decision (context, owner, needed-by, links) and see every decision on
 * this model. Like `ChangesPage`/`VersionsPage`, this list isn't scoped to
 * one ref — a decision is a model-wide fact, never branch-scoped — but the
 * breadcrumb's own `[ref]` chip and the "editing in a change" banner still
 * reflect the session's selected ref, same as every other model route.
 */
export function DecisionsPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const { userId } = useAuth();
  const { ref } = useSelectedRef();
  const { label: branchLabel } = useBranchLabel(ref);
  const [searchParams] = useSearchParams();
  // Prompt pack F3 PR6: "Start a decision" from a health finding or a
  // weak-capability tile lands here with its own context pre-filled —
  // `null` (the ordinary case, a bare `/decisions` link) opens the form
  // blank, same as before this PR.
  const prefill = parseDecisionPrefillFromSearchParams(searchParams);

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const canCreate = canStartDecision(role);

  if (orgLoading || modelsLoading || !model) {
    return (
      <div>
        <AppHeader orgId={organisation?.id ?? null} />
        <div className={navStyles.body}>
          <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
          <main className={styles.main}>
            <Text tone="muted">Loading…</Text>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} showModeShortcuts={false} />
          <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel={refLabelOf(ref, branchLabel)} />
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              Decisions
            </Text>
          </div>
          <DecisionsView modelId={model.id} orgId={organisation?.id ?? ''} userId={userId} orgSlug={orgSlug ?? ''} modelSlug={model.slug} canCreate={canCreate} prefill={prefill} />
        </main>
      </div>
    </div>
  );
}
