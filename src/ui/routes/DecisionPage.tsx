import { useEffect } from 'react';
import { Loading } from '../components/Loading/Loading';
import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { PageIdentity } from '../components/PageIdentity/PageIdentity';
import { DecisionView } from '../decisions/DecisionView';
import { useDecision } from '../decisions/useDecision';
import { useAuth } from '../auth/useAuth';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useSelectedRef } from '../branches/useSelectedRef';
import { refLabelOf } from '../../db/ref';
import { useModels } from '../models/useModels';
import { useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ViewPage.module.css';

/**
 * A single decision's own page (prompt pack F3 PR4, `/decisions/{id}`
 * route — routed on the decision's real id, `decisions` has no separate
 * slug column, same as `branches`).
 */
export function DecisionPage() {
  const { orgSlug, modelSlug, decisionId } = useParams<{ orgSlug: string; modelSlug: string; decisionId: string }>();
  const { userId } = useAuth();
  const { ref, clearRef } = useSelectedRef();
  const { label: branchLabel } = useBranchLabel(ref);

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role, loading: membershipLoading } = useMembership(organisation?.id ?? null, userId);
  // The one `useDecision` call for this page — `DecisionView` below reads
  // this same `state` and its write-result patches as props rather than
  // fetching its own second, independent copy (it used to; see
  // `DecisionView.tsx`'s own doc comment on why that duplication was
  // worth removing, not just wasteful).
  const { state, applyCreatedOption, applyNewOption, applyNewConcern, applyDecisionUpdate, refreshOptionsAndArguments } = useDecision(model?.id ?? '', decisionId ?? '');
  const title = state.status === 'ready' ? state.decision.title : 'Decision';

  // The decision page is main-context by design ("decisions are model-wide,
  // never branch-scoped" — `useDecision.ts`'s own comment). Arriving here
  // with one of this decision's own options still selected used to leave
  // that editing ref in place, so the shared banner offered "Back to the
  // decision" — a primary button linking to the page already on screen.
  // Leave the option's editing context on arrival instead: comparing and
  // choosing options happens against main, and the option stays one click
  // away in the grid ("Edit this change"). An option of *another* decision
  // keeps its ref — the banner's "Back to the decision" still means
  // something for those. Every setRef on this page navigates away to the
  // option's own change page, so this never fights a deliberate selection.
  const ownOptionSelected =
    state.status === 'ready' &&
    ref.kind === 'branch' &&
    state.links.some((l) => l.linked_type === 'branch' && l.linked_id === ref.branchId);
  useEffect(() => {
    if (ownOptionSelected) clearRef();
  }, [ownOptionSelected, clearRef]);

  if (orgLoading || modelsLoading || membershipLoading || !model) {
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

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} showModeShortcuts={false} currentDecisionId={decisionId} />
          <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel={refLabelOf(ref, branchLabel)} />
          <div className={styles.headerRow}>
            <PageIdentity kind="Decision" name={title} />
          </div>
          <DecisionView
            key={decisionId}
            modelId={model.id}
            decisionId={decisionId ?? ''}
            orgId={organisation?.id ?? ''}
            orgSlug={orgSlug ?? ''}
            modelSlug={model.slug}
            role={role}
            assistantEnabled={organisation?.ai_assistant_enabled === true}
            agentsEnabled={organisation?.ai_agents_enabled === true}
            keySet={organisation?.ai_agent_key_set === true}
            webSearchEnabled={organisation?.ai_web_search_enabled === true}
            shareCost={organisation?.ai_share_run_cost === true}
            state={state}
            applyCreatedOption={applyCreatedOption}
            applyNewOption={applyNewOption}
            applyNewConcern={applyNewConcern}
            applyDecisionUpdate={applyDecisionUpdate}
            refreshOptionsAndArguments={refreshOptionsAndArguments}
          />
        </main>
      </div>
    </div>
  );
}
