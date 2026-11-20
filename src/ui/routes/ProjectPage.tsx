import { Loading } from '../components/Loading/Loading';
import { useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { ProjectView } from '../projects/ProjectView';
import { useProject } from '../projects/useProject';
import { useAuth } from '../auth/useAuth';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useSelectedRef } from '../branches/useSelectedRef';
import { refLabelOf } from '../../db/ref';
import { useModels } from '../models/useModels';
import { useMembers } from '../orgs/useMembers';
import { profileLabel } from '../comments/profileLabel';
import { useMembership } from '../orgs/useMembership';
import { useDesignerTrial } from '../decisions/useDesignerTrial';
import { canOfferDesigner, designerUnavailableReason } from '../decisions/designerRequest';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import styles from './ViewPage.module.css';

/**
 * F10 step 3 (ADR-024 §6.2): one project's page, `/projects/{id}` —
 * routed on the project's real id (no slug column, same as decisions).
 */
export function ProjectPage() {
  const { orgSlug, modelSlug, projectId } = useParams<{ orgSlug: string; modelSlug: string; projectId: string }>();
  const { userId } = useAuth();
  const { ref } = useSelectedRef();
  const { label: branchLabel } = useBranchLabel(ref);

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const { members } = useMembers(organisation?.id ?? null);
  const ownerNames = members.filter((m) => m.member.role === 'owner').map((m) => profileLabel(m.profile));
  const { state, reload } = useProject(model?.id ?? '', projectId ?? '');
  const title = state.status === 'ready' ? state.data.project.title : 'Project';
  // Overdue is relative to today's date; read once per render, never stored.
  const today = new Date().toISOString().slice(0, 10);

  const trialStatus = useDesignerTrial(organisation?.id ?? null);
  const designerArgs = { role, assistantEnabled: organisation?.ai_assistant_enabled === true, agentsEnabled: organisation?.ai_agents_enabled === true, keySet: organisation?.ai_agent_key_set === true, ...(trialStatus ? { trial: trialStatus } : {}) };

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

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} showModeShortcuts={false} />
          <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel={refLabelOf(ref, branchLabel)} />
          <div className={styles.headerRow}>
            <Text as="h1" size="2xl">
              {title}
            </Text>
          </div>
          {state.status === 'loading' && <Loading />}
          {state.status === 'not_found' && <Text as="p">This project doesn't exist in this model, or you can't see it.</Text>}
          {state.status === 'error' && <Text as="p">{state.message}</Text>}
          {state.status === 'ready' && (
            <ProjectView data={state.data} modelName={model.name} orgId={organisation?.id ?? ''} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} userId={userId} role={role} today={today} reload={reload} designerAvailable={canOfferDesigner(designerArgs)} designerUnavailable={designerUnavailableReason({ ...designerArgs, ownerNames })} />
          )}
        </main>
      </div>
    </div>
  );
}
