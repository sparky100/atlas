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
import { groupProjectsByStatus, projectStatusLabel, projectStatusTone } from './projectModel';
import { projectFormFromPrefill } from './projectPrefill';
import { useProjects } from './useProjects';
import styles from './ProjectsView.module.css';

export interface ProjectsViewProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  orgSlug: string;
  modelSlug: string;
  /** `projects_insert`'s floor — the form is omitted, not disabled, when false. */
  canCreate: boolean;
  /** F10 step 7: "Start a project" from a health finding or an element page opens the form filled in. */
  prefill: DecisionPrefill | null;
}

/**
 * F10 step 2 (ADR-024 §6.1): the Projects list — grouped by status, live
 * work first — and the "Start a project" form (title, purpose, owner,
 * dates, optional declared scope).
 */
export function ProjectsView({ modelId, orgId, userId, orgSlug, modelSlug, canCreate, prefill }: ProjectsViewProps) {
  const navigate = useNavigate();
  const { status, projects, error, createProjectWithScope } = useProjects(modelId, orgId, userId);
  const { branch: main } = useMainBranch(modelId);
  const { members } = useMembers(orgId);
  const initial = prefill ? projectFormFromPrefill(prefill) : null;
  const [title, setTitle] = useState(() => initial?.title ?? '');
  const [purpose, setPurpose] = useState(() => initial?.purpose ?? '');
  const [ownerId, setOwnerId] = useState(userId ?? '');
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [scope, setScope] = useState<{ elementId: UUID; name: string }[]>(() => initial?.scope ?? []);
  const groups = groupProjectsByStatus(projects);

  return (
    <div>
      {canCreate && (
        <Panel>
          <Text as="h2" size="lg">
            Start a project
          </Text>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              if (!ownerId) return;
              void createProjectWithScope({
                title,
                purpose,
                ownerId,
                startDate,
                targetDate,
                ...(initial?.sourceFindingKey ? { sourceFindingKey: initial.sourceFindingKey } : {}),
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
                  Owner
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
                <option value="">Choose an owner…</option>
                {members.map((m) => (
                  <option key={m.member.user_id} value={m.member.user_id}>
                    {profileLabel(m.profile)}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.formRow}>
              <label htmlFor="project-start">
                <Text as="span" size="sm" tone="muted">
                  Start date
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
                  Target date
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
            {main?.head_commit_id && (
              <DecisionLinkPicker
                commitId={main.head_commit_id}
                modelId={modelId}
                selected={scope}
                placeholder="Search capabilities or systems this project is about…"
                onAdd={(elementId, name) => {
                  setScope((prev) => [...prev, { elementId, name }]);
                }}
                onRemove={(elementId) => {
                  setScope((prev) => prev.filter((s) => s.elementId !== elementId));
                }}
              />
            )}
            <Button variant="primary" type="submit" disabled={status === 'creating' || !ownerId || title.trim().length === 0}>
              {status === 'creating' ? 'Starting…' : 'Start project'}
            </Button>
          </form>
          {error !== null && <Text as="p">{error}</Text>}
        </Panel>
      )}

      {status === 'loading' && <Text tone="muted">Loading…</Text>}
      {projects.length === 0 && status !== 'loading' && <EmptyState>No projects yet. {canCreate ? 'Start one above.' : 'Nobody has started one.'}</EmptyState>}
      {groups.map((group) => (
        <section key={group.status} className={styles.group} aria-label={`${projectStatusLabel(group.status)} projects`}>
          <div className={styles.groupHeading}>
            <Text as="h2" size="lg">
              {projectStatusLabel(group.status)}
            </Text>
            <Text as="span" tone="muted" size="sm">
              ({group.projects.length})
            </Text>
          </div>
          <ul className={styles.list}>
            {group.projects.map((project) => (
              <ProjectRowItem key={project.id} project={project} orgSlug={orgSlug} modelSlug={modelSlug} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ProjectRowItem({ project, orgSlug, modelSlug }: { project: ProjectRow; orgSlug: string; modelSlug: string }) {
  return (
    <li className={styles.row}>
      <div>
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
      <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/projects/${project.id}`} variant="secondary" aria-label={`Open ${project.title}`}>
        Open →
      </LinkButton>
    </li>
  );
}
