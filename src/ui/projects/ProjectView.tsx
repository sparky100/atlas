import { addBaseline } from '../decisions/addBaseline';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { createChangeBranch } from '../../db/branches';
import { createDecision, createDecisionLink, listDecisionOptionLinksForModel } from '../../db/decisions';
import { useQuery } from '@tanstack/react-query';
import { orderOpenWork } from './openWorkOrder';
import { createEvidence } from '../../db/evidence';
import { addProjectLink, removeProjectLink, setProjectStatus, updateProject } from '../../db/projects';
import type { BranchIntent, BranchRow, DecisionRow, MemberRole, ProjectRow } from '../../db/types';
import { useMainBranch } from '../branches/useMainBranch';
import { dateFieldLabelForIntent, INTENT_LABEL, isDateRequiredForIntent, NEW_CHANGE_INTENT_OPTIONS } from '../changes/branchIntent';
import { branchStatusTone } from '../changes/branchStatus';
import { profileLabel } from '../comments/profileLabel';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { CommentsSection } from '../components/CommentsSection/CommentsSection';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { ProjectManagerField } from './ProjectManagerField';
import { projectManagerFromRow, projectManagerToInput, type ProjectManagerValue } from './projectManagerValue';
import { DecisionLinkPicker } from '../decisions/DecisionLinkPicker';
import { decisionStatusLabel, decisionStatusTone } from '../decisions/decisionStatus';
import { reportError } from '../errors/errorBannerStore';
import { canAcceptProject, canCreateChangeBranch, canEditProject, canStartDecision } from '../orgs/roleGates';
import { useMembers } from '../orgs/useMembers';
import { supabase } from '../supabaseClient';
import {
  formatProjectProgress,
  groupChangesByStage,
  isDecisionOverdue,
  openItemsBlockingClose,
  originatingDecision,
  projectChangeStageLabel,
  projectProgress,
  projectStatusLabel,
  projectStatusTone,
  scopeDifference,
  projectIsOpen,
  PROPOSED_PROJECT_EXPLAINER,
  proposalAcceptance,
  proposalHistoryLines,
  type ProposalAcceptance,
} from './projectModel';
import { loadProjectPack } from '../exports/loadProjectPack';
import { markdownToPdfBytes } from '../exports/markdownPdf';
import { buildProjectPackMarkdown, projectPackFilename } from '../exports/projectPack';
import { downloadBlob, exportDate } from '../exports/viewExport';
import { projectNextStep } from './projectNextStep';
import { findingLabel } from '../decisions/findingLabels';
import { suggestDecisionTitle } from '../decisions/optionSuggestions';
import { ProjectBeforeAfter } from './ProjectBeforeAfter';
import { DesignerSuggestions, type SuggestionSelection } from '../decisions/DesignerSuggestions';
import { DecisionDraftBanner } from '../decisions/DecisionDraftBanner';
import { useDecisionFormDraft } from '../decisions/useDecisionFormDraft';
import { clockNow, pendingKey, savePending } from '../decisions/pendingOptions';
import { ProjectStep } from './ProjectStep';
import { changesSummary, decisionsSummary, evidenceSummary, scopeSummary } from './projectStepSummary';
import type { ProjectData } from './useProject';
import { moduleDisplayNameFromMap } from '../elements/moduleDisplayName';
import styles from './ProjectView.module.css';

export interface ProjectViewProps {
  data: ProjectData;
  /** For the project pack's stamp and filename (F13 step 2). */
  modelName: string;
  orgId: UUID;
  modelId: UUID;
  orgSlug: string;
  modelSlug: string;
  userId: UUID | null;
  role: MemberRole | null;
  /** ISO `YYYY-MM-DD` — "overdue" is relative to this; injected so the page and its tests agree on today. */
  today: string;
  reload: () => void;
  /** Phase D: true only for an owner or architect in an organisation with Ask Atlas on, agents on and a key saved. */
  designerAvailable?: boolean;
  /** Why the Designer is not offered, shown beside the decision form. */
  designerUnavailable?: { text: string; canFix: boolean } | null;
}

/**
 * F10 steps 3–8 (ADR-024 §6.2): one project's page — purpose and owner,
 * declared scope against what its changes touch, the decision log
 * (own and constraining), changes by stage, evidence, comments, and the
 * project's own edit and status actions. Every rule (who may edit, what
 * may close) is enforced in the database; the UI only offers what the
 * person can do and explains refusals in plain words.
 */
export function ProjectView({ data, modelName, orgId, modelId, orgSlug, modelSlug, userId, role, today, reload, designerAvailable = false, designerUnavailable = null }: ProjectViewProps) {
  const { project, decisions, constrainingDecisions, changes, links, evidence, touched, elementsById } = data;
  const { members } = useMembers(orgId);
  const { branch: main } = useMainBranch(modelId);
  const canEdit = canEditProject(role, project, userId);
  const isOpen = projectIsOpen(project.status);
  const base = `/o/${orgSlug}/m/${modelSlug}`;
  const nameOfUser = (id: UUID | null) => {
    if (id === null) return 'Nobody';
    const member = members.find((m) => m.member.user_id === id);
    return member ? profileLabel(member.profile) : 'A former member';
  };
  const elementName = (id: UUID) => {
    const element = elementsById.get(id);
    return element ? moduleDisplayNameFromMap(element, elementsById) : (touched.find((t) => t.elementId === id)?.createdName ?? 'An element not in the live model yet');
  };

  const scopeIds = links.filter((l) => l.linked_type === 'element').map((l) => l.linked_id);
  const touchedIds = touched.map((t) => t.elementId);
  const scopeSystemIds = new Set(scopeIds.filter((id) => {
    const type = data.elementsById.get(id)?.element_type;
    return type === 'system' || type === 'container';
  }));
  const difference = scopeDifference(scopeIds, touchedIds, data.reachedIds);
  const progress = projectProgress(changes, decisions);
  const firstDecision = originatingDecision(decisions);
  const scopeNamesOfType = (types: readonly string[]) => scopeIds.filter((id) => types.includes(elementsById.get(id)?.element_type ?? '')).map((id) => elementName(id));
  const suggestedTitle = suggestDecisionTitle(scopeNamesOfType(['system', 'container']), scopeNamesOfType(['capability']));
  const canDecide = canStartDecision(role) && userId !== null;
  const canDraft = canCreateChangeBranch(role) && userId !== null && Boolean(main?.head_commit_id);
  const nextStep = projectNextStep({
    isOpen,
    purpose: project.purpose,
    hasCapability: data.scopeHasCapability,
    decisions,
    changes,
    canStartDecision: canDecide,
    canChoose: role === 'owner' || role === 'architect',
    canCreateChange: canCreateChangeBranch(role) && userId !== null,
    canDraftChange: Boolean(main?.head_commit_id),
  });
  // The card hosts the form for its step, so the same form is not drawn twice further down.
  const cardHostsDecisionForm = nextStep?.action.kind === 'start-decision';
  const cardHostsChangeForm = nextStep?.action.kind === 'start-change';

  return (
    <div className={styles.page}>
      <ProjectHeader project={project} ownerName={nameOfUser(project.owner_id)} managerName={project.project_manager_id ? nameOfUser(project.project_manager_id) : project.project_manager_name} progress={progress} proposalHistory={proposalHistoryLines(project, nameOfUser)} />

      <ProjectPackActions data={data} modelId={modelId} modelName={modelName} nameOfUser={nameOfUser} />

      {canEdit && <ProjectEditPanel project={project} members={members.map((m) => ({ id: m.member.user_id, label: profileLabel(m.profile) }))} onSaved={reload} />}

      {canEdit && <ProjectStatusPanel project={project} changes={changes} decisions={decisions} base={base} isProposer={userId !== null && userId === project.created_by} acceptance={proposalAcceptance({ isApprover: canAcceptProject(role), userId, proposedBy: project.created_by, approvers: members.filter((m) => m.member.role === 'owner' || m.member.role === 'architect').map((m) => ({ userId: m.member.user_id, name: profileLabel(m.profile) })) })} onChanged={reload} />}

      {!isOpen && (
        <Panel>
          <Text as="p">
            {project.status === 'closed' ? 'Closed' : 'Cancelled'} by {nameOfUser(project.closed_by)} on {project.closed_at?.slice(0, 10) ?? ''}
            {project.close_reason !== null ? ` — ${project.close_reason}` : ''}.
          </Text>
        </Panel>
      )}

      {nextStep !== null && (
        <Panel data-testid="project-next-step">
          <Text as="h2" size="lg">
            What to do next
          </Text>
          <Text as="p" size="md">
            {nextStep.title}
          </Text>
          <Text as="p" size="sm" tone="muted">
            {nextStep.body}
          </Text>
          {nextStep.action.kind === 'start-decision' && userId !== null && <NewDecisionForm project={project} userId={userId} scopeIds={scopeIds} suggestedTitle={suggestedTitle} base={base} designerAvailable={designerAvailable} designerUnavailable={designerUnavailable} orgSlug={orgSlug} />}
          {nextStep.action.kind === 'start-change' && userId !== null && main?.head_commit_id && <NewChangeForm project={project} userId={userId} mainHeadCommitId={main.head_commit_id} base={base} />}
          {nextStep.action.kind === 'open-decision' && (
            <Link to={`${base}/decisions/${nextStep.action.id}`}>{nextStep.action.label}</Link>
          )}
          {nextStep.action.kind === 'open-change' && <Link to={`${base}/changes/${nextStep.action.id}`}>{nextStep.action.label}</Link>}
        </Panel>
      )}

      <ProjectBeforeAfter modelId={modelId} projectId={project.id} mainHeadCommitId={main?.head_commit_id ?? null} changes={changes} capabilities={data.journeyCapabilities.map((c) => ({ id: c.id, name: c.name }))} scopeSystemIds={scopeSystemIds} decisions={decisions} base={base} />

      {(scopeIds.length > 0 || canEdit) && (
        <Panel>
          <ProjectStep stepKey="scope" projectId={project.id} title="Declared scope" summary={scopeSummary(scopeIds.length)} defaultOpen>
          <Text as="p" tone="muted" size="sm">
            The capabilities and systems this project is about.
          </Text>
          {isOpen && canEdit && !data.scopeHasCapability && (
            <div className={styles.needsCapability}>
              <Text as="p" size="sm">
                This project names no capability. A project can&apos;t stand apart from a capability — name at least one it serves.
              </Text>
              {data.derivedCapabilityCandidates.length > 0 && (
                <>
                  <Text as="p" tone="muted" size="sm">
                    From the systems already in scope:
                  </Text>
                  <div className={styles.capabilityChoices}>
                    {data.derivedCapabilityCandidates.map((cap) => (
                      <Button
                        key={cap.id}
                        variant="secondary"
                        aria-label={`Add ${cap.name} to scope`}
                        onClick={() => {
                          if (!userId || scopeIds.includes(cap.id)) return;
                          void addProjectLink(supabase, { projectId: project.id, linkedType: 'element', linkedId: cap.id, createdBy: userId }).then(reload, (e: unknown) => {
                            reportError('Could not add this capability to the scope.', e);
                          });
                        }}
                      >
                        Add {cap.name}
                      </Button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {scopeIds.length > 0 && (
            <ul className={styles.list}>
              {scopeIds.map((id) => (
                <li key={id} className={styles.row}>
                  <Link to={`${base}/e/${id}`}>{elementName(id)}</Link>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${elementName(id)} from scope`}
                      onClick={() => {
                        void removeProjectLink(supabase, project.id, 'element', id).then(reload, (e: unknown) => {
                          reportError('Could not remove this from the scope.', e);
                        });
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit && main?.head_commit_id && (
            <DecisionLinkPicker
              commitId={main.head_commit_id}
              modelId={modelId}
              selected={[]}
              placeholder="Add a capability or system to the scope…"
              onAdd={(elementId) => {
                if (!userId || scopeIds.includes(elementId)) return;
                void addProjectLink(supabase, { projectId: project.id, linkedType: 'element', linkedId: elementId, createdBy: userId }).then(reload, (e: unknown) => {
                  reportError('Could not add this to the scope.', e);
                });
              }}
              onRemove={() => undefined}
            />
          )}
          {(difference.touchedNotDeclared.length > 0 || difference.declaredNotTouched.length > 0) && (
            <div className={styles.scopeDiff}>
              {difference.touchedNotDeclared.length > 0 && (
                <div>
                  <Text as="h3" size="md">
                    Touched by this project&apos;s changes, not in scope
                  </Text>
                  <ul className={styles.inlineList}>
                    {difference.touchedNotDeclared.map((id) => (
                      <li key={id}>
                        <Link to={`${base}/e/${id}`}>{elementName(id)}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {difference.declaredNotTouched.length > 0 && changes.length > 0 && (
                <div>
                  <Text as="h3" size="md">
                    In scope, not touched or affected by any change yet
                  </Text>
                  <ul className={styles.inlineList}>
                    {difference.declaredNotTouched.map((id) => (
                      <li key={id}>
                        <Link to={`${base}/e/${id}`}>{elementName(id)}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          </ProjectStep>
        </Panel>
      )}

      {(decisions.length > 0 || constrainingDecisions.length > 0 || (isOpen && canStartDecision(role) && userId !== null)) && (
        <Panel>
          <ProjectStep stepKey="decisions" projectId={project.id} title="Decision log" summary={decisionsSummary(decisions.map((d) => d.status))} defaultOpen={decisions.length === 0 || decisions.some((d) => d.status === 'proposed')}>
          {decisions.length > 0 && (
            <ul className={styles.list}>
              {decisions.map((d) => (
                <DecisionLine key={d.id} decision={d} href={`${base}/decisions/${d.id}`} overdue={isDecisionOverdue(d, today)} first={firstDecision?.id === d.id && decisions.length > 1} />
              ))}
            </ul>
          )}
          {isOpen && canDecide && !cardHostsDecisionForm && <NewDecisionForm project={project} userId={userId} scopeIds={scopeIds} suggestedTitle={suggestedTitle} base={base} designerAvailable={designerAvailable} designerUnavailable={designerUnavailable} orgSlug={orgSlug} />}
          {constrainingDecisions.length > 0 && (
            <>
              <Text as="h3" size="md">
                Constraining decisions
              </Text>
              <Text as="p" tone="muted" size="sm">
                Decisions made elsewhere that this project must follow.
              </Text>
              <ul className={styles.list}>
                {constrainingDecisions.map((d) => (
                  <DecisionLine key={d.id} decision={d} href={`${base}/decisions/${d.id}`} overdue={false} first={false} />
                ))}
              </ul>
            </>
          )}
          </ProjectStep>
        </Panel>
      )}

      {(changes.length > 0 || (isOpen && canCreateChangeBranch(role) && userId !== null && Boolean(main?.head_commit_id))) && (
        <Panel>
          <ProjectStep stepKey="changes" projectId={project.id} title="Changes" summary={changesSummary(changes.length)} defaultOpen={changes.length === 0 || changes.some((c) => c.status !== 'merged' && c.status !== 'cancelled')}>
          {groupChangesByStage(changes).map((group) => (
            <section key={group.stage} aria-label={projectChangeStageLabel(group.stage)}>
              <Text as="h3" size="md">
                {projectChangeStageLabel(group.stage)} ({group.changes.length})
              </Text>
              <ul className={styles.list}>
                {group.changes.map((c) => (
                  <ChangeLine key={c.id} change={c} href={`${base}/changes/${c.id}`} />
                ))}
              </ul>
            </section>
          ))}
          {isOpen && canDraft && main?.head_commit_id && !cardHostsChangeForm && <NewChangeForm project={project} userId={userId} mainHeadCommitId={main.head_commit_id} base={base} />}
          </ProjectStep>
        </Panel>
      )}

      {(evidence.length > 0 || (canEdit && userId !== null)) && (
        <Panel>
          <ProjectStep stepKey="evidence" projectId={project.id} title="Evidence" summary={evidenceSummary(evidence.length)} defaultOpen={false}>
          <Text as="p" tone="muted" size="sm">
            Business cases, vendor documents and links behind this project.
          </Text>
          {evidence.length > 0 && (
            <ul className={styles.list}>
              {evidence.map((e) => (
                <li key={e.id} className={styles.row}>
                  <div>
                    {e.kind === 'link' && /^https?:\/\//i.test(e.pointer) ? (
                      <a href={e.pointer} target="_blank" rel="noreferrer noopener">
                        {e.description ?? e.pointer}
                      </a>
                    ) : (
                      <Text as="span">{e.description ?? e.pointer}</Text>
                    )}
                    <Text as="p" tone="faint" size="xs">
                      {e.kind === 'link' ? 'Link' : 'Document'} · {e.pointer} · added by {nameOfUser(e.added_by)}
                    </Text>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canEdit && userId !== null && <EvidenceForm project={project} userId={userId} onAdded={reload} />}
          </ProjectStep>
        </Panel>
      )}

      <Panel>
        <ProjectStep stepKey="comments" projectId={project.id} title="Comments" summary={'conversation on this project'} defaultOpen={false}>
        <CommentsSection orgId={orgId} modelId={modelId} userId={userId} role={role} anchorType="project" anchorId={project.id} branchId={null} />
        </ProjectStep>
      </Panel>
    </div>
  );
}

/**
 * F13 step 2: the project pack — purpose, scope, decision log, target state
 * per change and evidence in one document, as Markdown or PDF. Any member
 * can download it: it holds only what this page already shows them.
 */
function ProjectPackActions({ data, modelId, modelName, nameOfUser }: { data: ProjectData; modelId: UUID; modelName: string; nameOfUser: (id: UUID) => string }) {
  const [busy, setBusy] = useState<'md' | 'pdf' | null>(null);

  async function run(format: 'md' | 'pdf') {
    setBusy(format);
    try {
      const date = exportDate();
      const markdown = buildProjectPackMarkdown(await loadProjectPack({ modelId, modelName, date, data, nameOfUser }));
      const filename = projectPackFilename(modelName, data.project.title, date, format);
      if (format === 'md') {
        downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), filename);
      } else {
        const bytes = await markdownToPdfBytes(markdown, `Project pack: ${data.project.title}`);
        downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), filename);
      }
    } catch (e) {
      reportError("Couldn't export the project pack.", e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.packActions}>
      <Button variant="secondary" disabled={busy !== null} aria-label="Download project pack as Markdown" onClick={() => { void run('md'); }}>
        {busy === 'md' ? 'Preparing…' : 'Project pack (Markdown)'}
      </Button>
      <Button variant="secondary" disabled={busy !== null} aria-label="Download project pack as PDF" onClick={() => { void run('pdf'); }}>
        {busy === 'pdf' ? 'Preparing…' : 'Project pack (PDF)'}
      </Button>
    </div>
  );
}

function ProjectHeader({ project, ownerName, managerName, progress, proposalHistory }: { project: ProjectRow; ownerName: string; managerName: string | null; progress: ReturnType<typeof projectProgress>; proposalHistory: readonly string[] }) {
  return (
    <div className={styles.header}>
      <div className={styles.meta}>
        <Chip tone={projectStatusTone(project.status)}>{projectStatusLabel(project.status)}</Chip>
        <Text as="span" size="sm">
          Architect: {ownerName}
        </Text>
        <Text as="span" size="sm">
          Project manager: {managerName ?? 'Not set'}
        </Text>
        {project.start_date !== null && (
          <Text as="span" size="sm" tone="muted">
            Start: {project.start_date}
          </Text>
        )}
        {project.target_date !== null && (
          <Text as="span" size="sm" tone="muted">
            Target: {project.target_date}
          </Text>
        )}
      </div>
      {project.status === 'proposed' && (
        <Text as="p" size="sm">
          This is a proposal. {PROPOSED_PROJECT_EXPLAINER}
        </Text>
      )}
      {proposalHistory.length > 0 && (
        <div data-testid="project-proposal-history">
          {proposalHistory.map((line) => (
            <Text key={line} as="p" size="sm" tone="muted">
              {line}
            </Text>
          ))}
        </div>
      )}
      {project.purpose !== '' && <Text as="p">{project.purpose}</Text>}
      {findingLabel(project.source_finding_key) !== null && (
        <div data-testid="project-source-finding">
<Text as="p" tone="muted" size="sm">
          Started from a health finding: {findingLabel(project.source_finding_key)}.
        </Text>
</div>
      )}
      <Text as="p" tone="muted" size="sm">
        {formatProjectProgress(progress)}
      </Text>
    </div>
  );
}

function DecisionLine({ decision, href, overdue, first }: { decision: DecisionRow; href: string; overdue: boolean; first: boolean }) {
  return (
    <li className={styles.row}>
      <div>
        <Link to={href}>{decision.title}</Link>
        <div className={styles.meta}>
          <Chip tone={decisionStatusTone(decision.status)}>{decisionStatusLabel(decision.status)}</Chip>
          {overdue && <Chip tone="warn">Overdue — needed by {decision.needed_by}</Chip>}
          {first && (
            <Text as="span" size="xs" tone="faint">
              First decision
            </Text>
          )}
        </div>
      </div>
    </li>
  );
}

function ChangeLine({ change, href }: { change: BranchRow; href: string }) {
  return (
    <li className={styles.row}>
      <div>
        <Link to={href}>{change.title ?? change.name}</Link>
        <div className={styles.meta}>
          <Chip tone={branchStatusTone(change.status)}>{change.status}</Chip>
          {change.intent !== null && (
            <Text as="span" size="xs" tone="faint">
              {INTENT_LABEL[change.intent]}
            </Text>
          )}
          {change.target_date !== null && (
            <Text as="span" size="xs" tone="faint">
              Target: {change.target_date}
            </Text>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Step 4: "New decision" from the project page — created inside the project
 * (`decisions.project_id`), owned by the person starting it. It starts from
 * where the person came from (Simon, 2026-11-19): the project's purpose is the
 * decision's context, the project's declared scope is what it concerns, and the
 * decision page opens in edit mode so the wording can be shaped straight away.
 */
function NewDecisionForm({
  project,
  userId,
  scopeIds,
  suggestedTitle,
  base,
  designerAvailable,
  designerUnavailable,
  orgSlug,
}: {
  project: ProjectRow;
  userId: UUID;
  scopeIds: readonly UUID[];
  suggestedTitle: string;
  base: string;
  designerAvailable: boolean;
  designerUnavailable: { text: string; canFix: boolean } | null;
  orgSlug: string;
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(suggestedTitle);
  // The Designer drafts options from what the project is about, the same panel the Decisions page offers (Simon, 2026-11-19: it must appear here too). Its draft is added to the context and the decision records that an agent helped.
  const [statement, setStatement] = useState(project.purpose.trim());
  const [suggested, setSuggested] = useState<SuggestionSelection>({ options: [], draftedAt: null, anyEdited: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = useDecisionFormDraft(project.org_id, userId, `project-${project.id}`, { title, statement });
  const firstScope = scopeIds[0];
  // The Designer is sent what is written in the box below, so correcting it changes the brief.
  const aiDraft = suggested.draftedAt !== null ? { draftedAt: suggested.draftedAt, edited: suggested.anyEdited } : null;
  return (
    <form
      className={[styles.inlineForm, styles.inlineFormWide].filter(Boolean).join(' ')}
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim().length === 0) return;
        setBusy(true);
        setError(null);
        void createDecision(supabase, { id: crypto.randomUUID(), orgId: project.org_id, modelId: project.model_id, title: title.trim(), statement, ownerId: userId, ...(aiDraft !== null ? { aiDraft: { agent: 'designer' as const, draftedAt: aiDraft.draftedAt, edited: aiDraft.edited } } : {}), ...(project.source_finding_key !== null ? { sourceFindingKey: project.source_finding_key } : {}), createdBy: userId, projectId: project.id })
          .then(async (d) => {
            // Every decision starts with its "Stay as we are" baseline; if this fails the decision page offers "Add the baseline".
            await addBaseline({ orgId: project.org_id, modelId: project.model_id, decisionId: d.id, userId, projectId: project.id }).catch((err: unknown) => {
              reportError('Could not add the baseline to the new decision.', err);
            });
            // What the project is about is what the decision concerns. A link that fails is skipped: the decision page lets the person add it.
            for (const elementId of scopeIds) {
              await createDecisionLink(supabase, { decisionId: d.id, linkedType: 'element', linkedId: elementId, createdBy: userId }).catch((err: unknown) => {
                reportError('Could not link the project scope to the new decision.', err);
              });
            }
            // The options the person kept are saved on the decision page as it opens, one by one, so a failure there can be retried without losing them.
            if (suggested.options.length > 0) savePending(localStorage, pendingKey(project.org_id, userId, d.id), suggested.options, clockNow());
            draft.clear();
            void navigate(`${base}/decisions/${d.id}${suggested.options.length > 0 ? '' : '?edit=1'}`);
          })
          .catch((err: unknown) => {
            setError('Could not start this decision.');
            reportError('Could not start this decision.', err);
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      {draft.offered !== null && (
        <DecisionDraftBanner
          draft={draft.offered}
          onRestore={(d) => {
            setTitle(d.title);
            setStatement(d.statement);
            draft.accept();
          }}
          onDiscard={draft.discard}
        />
      )}
      <input
        className={styles.input}
        type="text"
        aria-label="New decision title"
        placeholder="New decision in this project (e.g. Which integration pattern?)"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          draft.remember({ title: e.target.value, statement });
        }}
      />
      <label>
        <Text as="span" size="sm">What the options need to solve</Text>
        <textarea
          className={styles.input}
          aria-label="What the options need to solve"
          placeholder="Say what you need, in your own words"
          rows={3}
          value={statement}
          onChange={(e) => {
            setStatement(e.target.value);
            draft.remember({ title, statement: e.target.value });
          }}
        />
      </label>
      {designerAvailable && firstScope !== undefined && (
        <DesignerSuggestions orgId={project.org_id} userId={userId} modelId={project.model_id} elementId={firstScope} brief={statement.trim() !== '' ? statement : project.title} scope={`project-${project.id}`} onChange={setSuggested} />
      )}
      {!designerAvailable && designerUnavailable !== null && firstScope !== undefined && (
        <div data-testid="designer-unavailable">
          <Text as="p" tone="muted" size="sm">
            {designerUnavailable.text} {designerUnavailable.canFix && <Link to={`/o/${orgSlug}/settings`}>Open organisation settings</Link>}
          </Text>
        </div>
      )}
      <Button type="submit" disabled={busy || title.trim().length === 0}>
        {busy ? 'Starting…' : suggested.options.length > 0 ? `Start decision with ${String(suggested.options.length)} suggested ${suggested.options.length === 1 ? 'option' : 'options'}` : 'Start decision'}
      </Button>
      {error !== null && <Text as="p">{error}</Text>}
    </form>
  );
}

/** Step 4: "New change" from the project page — created inside the project (`branches.project_id`). */
function NewChangeForm({ project, userId, mainHeadCommitId, base }: { project: ProjectRow; userId: UUID; mainHeadCommitId: UUID; base: string }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [intent, setIntent] = useState<BranchIntent>('propose');
  const [targetDate, setTargetDate] = useState('');
  const dateLabel = dateFieldLabelForIntent(intent);
  const dateMissing = isDateRequiredForIntent(intent) && targetDate === '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className={styles.inlineForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim().length === 0 || dateMissing) return;
        setBusy(true);
        setError(null);
        void createChangeBranch(supabase, {
          id: crypto.randomUUID(),
          orgId: project.org_id,
          modelId: project.model_id,
          title: title.trim(),
          createdBy: userId,
          mainHeadCommitId,
          intent,
          ...(dateLabel !== null && targetDate !== '' ? { targetDate } : {}),
          projectId: project.id,
        })
          .then((b) => navigate(`${base}/changes/${b.id}?ref=branch:${b.id}`))
          .catch((err: unknown) => {
            setError('Could not start this change.');
            reportError('Could not start this change.', err);
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <input
        className={styles.input}
        type="text"
        aria-label="What's this change?"
        placeholder="What's this change? (e.g. CRM cutover)"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
        }}
      />
      <select
        className={styles.input}
        aria-label="New change intent"
        value={intent}
        onChange={(e) => {
          setIntent(e.target.value as BranchIntent);
        }}
      >
        {NEW_CHANGE_INTENT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {dateLabel !== null && (
        <input
          className={styles.input}
          type="date"
          aria-label={dateLabel}
          value={targetDate}
          onChange={(e) => {
            setTargetDate(e.target.value);
          }}
        />
      )}
      <Button type="submit" disabled={busy || title.trim().length === 0 || dateMissing}>
        {busy ? 'Starting…' : 'Start change'}
      </Button>
      {error !== null && <Text as="p">{error}</Text>}
    </form>
  );
}

/** Step 5: the first authoring path for `evidence` — a link or document reference, attached to the project. */
function EvidenceForm({ project, userId, onAdded }: { project: ProjectRow; userId: UUID; onAdded: () => void }) {
  const [kind, setKind] = useState<'link' | 'document'>('link');
  const [pointer, setPointer] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className={styles.inlineForm}
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = pointer.trim();
        if (trimmed.length === 0) return;
        if (kind === 'link' && !/^https?:\/\/\S+$/i.test(trimmed)) {
          setError('A link must start with http:// or https://.');
          return;
        }
        setBusy(true);
        setError(null);
        void (async () => {
          try {
            const row = await createEvidence(supabase, { id: crypto.randomUUID(), orgId: project.org_id, modelId: project.model_id, kind, pointer: trimmed, description: description.trim().length > 0 ? description.trim() : null, addedBy: userId });
            await addProjectLink(supabase, { projectId: project.id, linkedType: 'evidence', linkedId: row.id, createdBy: userId });
            setPointer('');
            setDescription('');
            onAdded();
          } catch (err) {
            setError('Could not attach this evidence.');
            reportError('Could not attach this evidence.', err);
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <select
        className={styles.input}
        aria-label="Evidence kind"
        value={kind}
        onChange={(e) => {
          setKind(e.target.value as 'link' | 'document');
        }}
      >
        <option value="link">Link</option>
        <option value="document">Document reference</option>
      </select>
      <input
        className={styles.input}
        type="text"
        aria-label="Evidence location"
        placeholder={kind === 'link' ? 'https://…' : 'Where the document lives (e.g. SharePoint › Business cases › CRM v3)'}
        value={pointer}
        onChange={(e) => {
          setPointer(e.target.value);
        }}
      />
      <input
        className={styles.input}
        type="text"
        aria-label="Evidence description"
        placeholder="What it is (optional, e.g. Business case v3)"
        value={description}
        onChange={(e) => {
          setDescription(e.target.value);
        }}
      />
      <Button type="submit" disabled={busy || pointer.trim().length === 0}>
        {busy ? 'Attaching…' : 'Attach evidence'}
      </Button>
      {error !== null && <Text as="p">{error}</Text>}
    </form>
  );
}

/** §4: edit the project's own fields — its creator or owner, or an org owner/architect, while open. */
function ProjectEditPanel({ project, members, onSaved }: { project: ProjectRow; members: { id: UUID; label: string }[]; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(project.title);
  const [purpose, setPurpose] = useState(project.purpose);
  const [ownerId, setOwnerId] = useState(project.owner_id);
  const [manager, setManager] = useState<ProjectManagerValue>(() => projectManagerFromRow(project));
  const [startDate, setStartDate] = useState(project.start_date ?? '');
  const [targetDate, setTargetDate] = useState(project.target_date ?? '');
  const [error, setError] = useState<string | null>(null);
  if (!editing) {
    return (
      <div>
        <Button
          onClick={() => {
            setEditing(true);
          }}
        >
          ✎ Edit project
        </Button>
      </div>
    );
  }
  return (
    <Panel>
      <form
        className={styles.inlineForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim().length === 0) {
            setError('Title cannot be empty.');
            return;
          }
          if (startDate !== '' && targetDate !== '' && targetDate < startDate) {
            setError('The target date is before the start date.');
            return;
          }
          void updateProject(supabase, project.id, { title: title.trim(), purpose: purpose.trim(), ownerId, ...projectManagerToInput(manager), startDate: startDate === '' ? null : startDate, targetDate: targetDate === '' ? null : targetDate }).then(
            () => {
              setEditing(false);
              onSaved();
            },
            (err: unknown) => {
              setError('Could not save these changes.');
              reportError('Could not save this project.', err);
            },
          );
        }}
      >
        <input className={styles.input} aria-label="Project title" value={title} onChange={(e) => { setTitle(e.target.value); }} />
        <textarea className={styles.input} aria-label="Purpose" value={purpose} onChange={(e) => { setPurpose(e.target.value); }} />
        <select className={styles.input} aria-label="Architect" value={ownerId} onChange={(e) => { setOwnerId(e.target.value); }}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <ProjectManagerField value={manager} members={members} onChange={setManager} selectClassName={styles.input} inputClassName={styles.input} />
        <input className={styles.input} type="date" aria-label="Start date" value={startDate} onChange={(e) => { setStartDate(e.target.value); }} />
        <input className={styles.input} type="date" aria-label="Target date" value={targetDate} onChange={(e) => { setTargetDate(e.target.value); }} />
        <div className={styles.meta}>
          <Button variant="primary" type="submit">
            Save
          </Button>
          <Button
            onClick={() => {
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
        {error !== null && <Text as="p">{error}</Text>}
      </form>
    </Panel>
  );
}

/**
 * Step 8 (§4, P4): hold/resume, close and cancel. Close and cancel are
 * offered only when nothing is open; otherwise the open items are listed,
 * each linking to its own page where its own existing action ends it — the
 * project never cancels anything itself.
 */
function ProjectStatusPanel({ project, changes, decisions, base, acceptance, isProposer, onChanged }: { project: ProjectRow; changes: BranchRow[]; decisions: DecisionRow[]; base: string; isProposer: boolean; acceptance: ProposalAcceptance; onChanged: () => void }) {
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'idle' | 'cancelling'>('idle');
  const [error, setError] = useState<string | null>(null);
  const open = openItemsBlockingClose(changes, decisions);
  const blocked = open.changes.length > 0 || open.decisions.length > 0;
  const links = useQuery({ queryKey: ['projectOptionLinks', project.model_id], enabled: blocked, queryFn: () => listDecisionOptionLinksForModel(supabase, project.model_id) });
  const ordered = orderOpenWork(open.decisions, open.changes, links.data ?? []);
  // Whoever drafted a proposal withdraws it (cancel); someone else turning it down declines it. Both record the same status and reason.
  const withdrawing = project.status === 'proposed' && isProposer;
  const proposalVerb = withdrawing ? 'Cancel' : 'Decline';

  const run = (status: ProjectRow['status'], why?: string) => {
    setError(null);
    void setProjectStatus(supabase, project.id, status, why).then(
      (result) => {
        if (result.status === 'open_items') {
          setError('Something in this project is still open — it has to be finished or cancelled first.');
          onChanged();
          return;
        }
        setMode('idle');
        onChanged();
      },
      (err: unknown) => {
        setError('Could not change this project\'s status.');
        reportError("Could not change this project's status.", err);
      },
    );
  };

  return (
    <Panel>
      <Text as="h2" size="lg">
        Status
      </Text>
      <div className={styles.meta}>
        {project.status === 'proposed' && acceptance.canAccept && (
          <Button
            variant="primary"
            onClick={() => {
              run('active');
            }}
          >
            Accept proposal
          </Button>
        )}
        {project.status === 'proposed' && acceptance.message !== null && (
          <Text as="p" size="sm" tone="muted">
            {acceptance.message}
          </Text>
        )}
        {project.status === 'active' && (
          <Button
            onClick={() => {
              run('on_hold');
            }}
          >
            Put on hold
          </Button>
        )}
        {project.status === 'on_hold' && (
          <Button
            onClick={() => {
              run('active');
            }}
          >
            Resume
          </Button>
        )}
        {!blocked && project.status !== 'proposed' && (
          <Button
            variant="primary"
            onClick={() => {
              run('closed');
            }}
          >
            Close project
          </Button>
        )}
        {!blocked && mode === 'idle' && (
          <Button
            onClick={() => {
              setMode('cancelling');
            }}
          >
            {project.status === 'proposed' ? `${proposalVerb} proposal…` : 'Cancel project…'}
          </Button>
        )}
      </div>
      {!blocked && mode === 'cancelling' && (
        <form
          className={styles.inlineForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length === 0) {
              setError('Say why the project is being cancelled.');
              return;
            }
            run('cancelled', reason.trim());
          }}
        >
          <input className={styles.input} type="text" aria-label="Why is this project being cancelled?" placeholder={project.status === 'proposed' ? withdrawing ? 'Why is this proposal being withdrawn?' : 'Why is this proposal being declined?' : 'Why is this project being cancelled?'} value={reason} onChange={(e) => { setReason(e.target.value); }} />
          <div className={styles.meta}>
            <Button variant="primary" type="submit">
              {project.status === 'proposed' ? `${proposalVerb} proposal` : 'Cancel project'}
            </Button>
            <Button
              onClick={() => {
                setMode('idle');
              }}
            >
              Keep it
            </Button>
          </div>
        </form>
      )}
      {blocked && (
        <div>
          <Text as="p" size="sm">
            To close or cancel this project, first finish or cancel what is still open in it:
          </Text>
          <ul className={styles.inlineList}>
            {ordered.groups.map((g) => (
              <li key={g.decision.id}>
                <Link to={`${base}/decisions/${g.decision.id}`}>{g.decision.title}</Link> (decision, proposed)
                {g.changes.length > 0 && (
                  <ul className={styles.inlineList}>
                    {g.changes.map((c) => (
                      <li key={c.id}>
                        <Link to={`${base}/changes/${c.id}`}>{c.title ?? c.name}</Link> (option, {c.status})
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
            {ordered.standalone.map((c) => (
              <li key={c.id}>
                <Link to={`${base}/changes/${c.id}`}>{c.title ?? c.name}</Link> (change, {c.status})
              </li>
            ))}
          </ul>
        </div>
      )}
      {error !== null && <Text as="p">{error}</Text>}
    </Panel>
  );
}
