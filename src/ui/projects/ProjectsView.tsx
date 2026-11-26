import { Loading } from '../components/Loading/Loading';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { ProjectRow } from '../../db/types';
import { useMainBranch } from '../branches/useMainBranch';
import { profileLabel } from '../comments/profileLabel';
import { Button } from '../components/Button/Button';
import { LinkButton } from '../components/Button/LinkButton';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import type { DecisionPrefill } from '../decisions/decisionPrefill';
import { DecisionLinkPicker } from '../decisions/DecisionLinkPicker';
import { useMembers } from '../orgs/useMembers';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { groupProjectsByStatus, PROPOSED_PROJECT_EXPLAINER, projectStatusLabel, projectStatusTone, scopeHasCapability, type ProjectScopeItem } from './projectModel';
import { ProjectManagerField } from './ProjectManagerField';
import { NO_PROJECT_MANAGER, projectManagerToInput, type ProjectManagerValue } from './projectManagerValue';
import { projectFormFromPrefill } from './projectPrefill';
import { useProjects } from './useProjects';
import { useSupportedCapabilities } from './useSupportedCapabilities';
import styles from './ProjectsView.module.css';

export interface ProjectsViewProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  orgSlug: string;
  modelSlug: string;
  /** `projects_insert`'s floor — the form is omitted, not disabled, when false. */
  canCreate: boolean;
  /** Owner or architect: may start a project outright. Anyone else who can create one (a contributor) can only propose it. Defaults to true. */
  canStartActive?: boolean;
  /** F10 step 7: "Start a project" from a health finding or an element page opens the form filled in. */
  prefill: DecisionPrefill | null;
}

/**
 * F10 step 2 (ADR-024 §6.1): the Projects list — grouped by status, live
 * work first — and the "Start a project" form (title, purpose, owner,
 * dates, optional declared scope).
 */
export function ProjectsView({ modelId, orgId, userId, orgSlug, modelSlug, canCreate, canStartActive = true, prefill }: ProjectsViewProps) {
  const navigate = useNavigate();
  const { status, projects, error, createProjectWithScope } = useProjects(modelId, orgId, userId);
  const { branch: main } = useMainBranch(modelId);
  const { members } = useMembers(orgId);
  const initial = prefill ? projectFormFromPrefill(prefill) : null;
  const [title, setTitle] = useState(() => initial?.title ?? '');
  const [purpose, setPurpose] = useState(() => initial?.purpose ?? '');
  const [ownerId, setOwnerId] = useState(userId ?? '');
  const [manager, setManager] = useState<ProjectManagerValue>(NO_PROJECT_MANAGER);
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [scope, setScope] = useState<ProjectScopeItem[]>(() => initial?.scope ?? []);
  const [proposalChoice, setAsProposal] = useState(false);
  // A contributor can only propose; an owner or architect chooses.
  const asProposal = !canStartActive || proposalChoice;
  const supportNotices = useSupportedCapabilities(main?.head_commit_id ?? null, scope, setScope);
  const groups = groupProjectsByStatus(projects);
  // Plan A1 / Simon's rule: a project must name at least one capability.
  const hasCapability = scopeHasCapability(scope);

  return (
    <div>
      {canCreate && (
        <Panel>
          <Text as="h2" size="lg">
            {canStartActive ? 'Start a project' : 'Propose a project'}
          </Text>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              if (!ownerId || !hasCapability) return;
              void createProjectWithScope({
                title,
                purpose,
                ownerId,
                ...projectManagerToInput(manager),
                startDate,
                targetDate,
                ...(initial?.sourceFindingKey ? { sourceFindingKey: initial.sourceFindingKey } : {}),
                asProposal,
                scopeElementIds: scope.map((s) => s.elementId),
              }).then((project) => {
                if (project) void navigate(`/o/${orgSlug}/m/${modelSlug}/projects/${project.id}`);
              });
            }}
          >
            <input
              className={styles.input}
              type="text"
              aria-label="Project title"
              placeholder="Title (e.g. Housing CRM replacement)"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
            <textarea
              className={styles.textarea}
              aria-label="Purpose"
              placeholder="Purpose — the problem or opportunity, in plain words"
              value={purpose}
              onChange={(e) => {
                setPurpose(e.target.value);
              }}
            />
            <div className={styles.formRow}>
              <label htmlFor="project-owner">
                <Text as="span" size="sm" tone="muted">
                  Architect
                </Text>
              </label>
              <select
                id="project-owner"
                className={styles.select}
                value={ownerId}
                onChange={(e) => {
                  setOwnerId(e.target.value);
                }}
              >
                <option value="">Choose an architect…</option>
                {members.map((m) => (
                  <option key={m.member.user_id} value={m.member.user_id}>
                    {profileLabel(m.profile)}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.formRow}>
              <Text as="span" size="sm" tone="muted">
                Project manager
              </Text>
              <ProjectManagerField
                value={manager}
                members={members.map((m) => ({ id: m.member.user_id, label: profileLabel(m.profile) }))}
                onChange={setManager}
                selectClassName={styles.select}
                inputClassName={styles.input}
              />
            </div>
            <div className={styles.datesRow}>
              <div className={styles.formRow}>
                <label htmlFor="project-start">
                  <Text as="span" size="sm" tone="muted">
                    Start date (optional)
                  </Text>
                </label>
                <input
                  id="project-start"
                  className={styles.input}
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                  }}
                />
              </div>
              <div className={styles.formRow}>
                <label htmlFor="project-target">
                  <Text as="span" size="sm" tone="muted">
                    Target date (optional)
                  </Text>
                </label>
                <input
                  id="project-target"
                  className={styles.input}
                  type="date"
                  value={targetDate}
                  onChange={(e) => {
                    setTargetDate(e.target.value);
                  }}
                />
              </div>
            </div>
            {main?.head_commit_id && (
              <DecisionLinkPicker
                commitId={main.head_commit_id}
                modelId={modelId}
                selected={scope}
                placeholder="Search a capability this project serves (and any systems it touches)…"
                onAdd={(elementId, name, elementType) => {
                  setScope((prev) => [...prev, { elementId, name, elementType }]);
                }}
                onRemove={(elementId) => {
                  setScope((prev) => prev.filter((s) => s.elementId !== elementId));
                }}
              />
            )}
            {supportNotices.map((text) => (
              <Text key={text} as="p" size="sm" tone="muted">
                {text}
              </Text>
            ))}
            {!hasCapability && (
              <Text as="p" size="sm" tone="muted">
                Name at least one capability this project serves — a project can’t stand apart from a capability.
              </Text>
            )}
            {canStartActive && (
              <label>
                <input
                  type="checkbox"
                  checked={asProposal}
                  onChange={(e) => {
                    setAsProposal(e.target.checked);
                  }}
                />{' '}
                <Text as="span" size="sm">
                  Start as a proposal
                </Text>
              </label>
            )}
            <div data-testid="project-proposal-note">
              <Text as="p" size="sm" tone="muted">
                {canStartActive ? PROPOSED_PROJECT_EXPLAINER : `You can propose a project; an owner or architect decides whether it goes ahead. ${PROPOSED_PROJECT_EXPLAINER}`}
              </Text>
            </div>
            <Button variant="primary" type="submit" disabled={status === 'creating' || !ownerId || title.trim().length === 0 || !hasCapability}>
              {status === 'creating' ? 'Starting…' : asProposal ? 'Propose project' : 'Start project'}
            </Button>
          </form>
          {error !== null && <Text as="p">{error}</Text>}
        </Panel>
      )}

      {status === 'loading' && <Loading />}
      {projects.length === 0 && status !== 'loading' && <EmptyState>No projects yet. {canCreate ? 'Start one above.' : 'Nobody has started one.'}</EmptyState>}
      {groups.map((group) => (
        <CollapsibleSection
          key={group.status}
          title={`${projectStatusLabel(group.status)} projects`}
          meta={`(${String(group.projects.length)})`}
          // Work in hand stays open; finished and cancelled projects are one click away.
          defaultOpen={group.status !== 'cancelled' && group.status !== 'closed'}
        >
          {group.status === 'proposed' && (
            <Text as="p" size="sm" tone="muted">
              {PROPOSED_PROJECT_EXPLAINER}
            </Text>
          )}
          <ul className={styles.list}>
            {group.projects.map((project) => (
              <ProjectRowItem key={project.id} project={project} orgSlug={orgSlug} modelSlug={modelSlug} />
            ))}
          </ul>
        </CollapsibleSection>
      ))}
    </div>
  );
}

function ProjectRowItem({ project, orgSlug, modelSlug }: { project: ProjectRow; orgSlug: string; modelSlug: string }) {
  return (
    <li className={styles.row}>
      <div className={styles.rowText}>
        <Text as="span" size="lg">
          {project.title}
        </Text>
        {project.purpose !== '' && (
          <Text as="p" tone="muted" size="sm">
            {project.purpose}
          </Text>
        )}
        <div className={styles.rowMeta}>
          <Chip tone={projectStatusTone(project.status)}>{projectStatusLabel(project.status)}</Chip>
          {project.target_date !== null && (
            <Text as="span" tone="faint" size="xs">
              Target: {project.target_date}
            </Text>
          )}
        </div>
      </div>
      <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/projects/${project.id}`} variant="secondary" className={styles.rowAction} aria-label={`Open ${project.title}`}>
        Open →
      </LinkButton>
    </li>
  );
}
