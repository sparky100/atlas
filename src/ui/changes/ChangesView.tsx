import { cancelReasonText } from './cancelReasonText';
import { Loading } from '../components/Loading/Loading';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { ChangeListSummary } from '../../db/changeSummary';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { LinkButton } from '../components/Button/LinkButton';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useSelectedRef } from '../branches/useSelectedRef';
import { useThreadCounts } from '../comments/useThreadCounts';
import type { BranchIntent, BranchRow } from '../../db/types';
import { branchStatusTone } from './branchStatus';
import { dateFieldLabelForIntent, INTENT_LABEL, NEW_CHANGE_INTENT_OPTIONS } from './branchIntent';
import { groupChangesList } from './changesListGroups';
import { buildChangesHierarchy, type DecisionBlock } from './changesHierarchy';
import { useChangesHierarchyData } from './useChangesHierarchyData';
import { OPEN_CHANGE_STATUSES } from '../../db/branches';
import { useRouteTiming } from '../perf/useRouteTiming';
import { useChangeSummaries } from './useChangeSummaries';
import { focusImpact } from './impactFocus';
import { useChanges } from './useChanges';
import { DraftWithAi } from './DraftWithAi';
import { GuidedChange, type GuidedChangeStart } from './GuidedChange';
import styles from './ChangesView.module.css';

export interface ChangesViewProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  orgSlug: string;
  modelSlug: string;
  /** Contributor+ (ADR-009, `branches_insert`'s RLS) — omitted entirely, not shown disabled, otherwise (the same convention `canEditOnMain`'s callers already use). */
  canCreate: boolean;
  /** The organisation's Ask Atlas setting, which also switches Draft with AI on. */
  aiEnabled?: boolean;
  /** Owners can switch the setting on, so the "off" hint links them to it. */
  isOwner?: boolean;
}

/**
 * Sprint C1 step 3: "Create change (branch) with name, description, target
 * date" plus a list of every change on this model. Mirrors
 * src/ui/versions/VersionsView.tsx's shape (a create form gated by role,
 * loading/empty states, a list of rows linking onward). Editing on the
 * branch, the As-is/To-be/Diff selector, the change page's own delta
 * summary, and the merge review queue are later Sprint C1 steps — this is
 * create + list + a status chip only.
 */
const joinClasses = (...names: (string | undefined)[]): string => names.filter(Boolean).join(' ');

export function ChangesView({ modelId, orgId, userId, orgSlug, modelSlug, canCreate, aiEnabled = false, isOwner = false }: ChangesViewProps) {
  const navigate = useNavigate();
  const { setRef } = useSelectedRef();
  const { status, branches, error, mainHeadCommitId, createChange } = useChanges(modelId, orgId, userId);
  // E8 ("performance") phase 1: this route's own resolve/first-paint/data-complete marks — see useRouteTiming.ts's own module comment. `useChanges`' own status has no 'ready' state; 'idle' is its own "loaded, no create-form submission in flight" — the data-complete signal here.
  useRouteTiming('changes', status === 'idle');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');
  // Prompt pack F0: this form's own "New change" surface is the one entry
  // point with no fixed default per `branchIntent.ts`'s own
  // `defaultIntentForEntryPoint` doc comment — the person picks explicitly.
  const [intent, setIntent] = useState<BranchIntent>('propose');
  // While the AI draft form is open it replaces the manual fields, so the page has one form at a time.
  const [aiOpen, setAiOpen] = useState(false);
  // F0: "correct/explore need no date at all" — same per-intent rule the
  // change page's own edit form already applies; the create form didn't
  // (a real bug: the date field used to render unconditionally here).
  const dateFieldLabel = dateFieldLabelForIntent(intent);
  // Changes list unresolved count (Sprint M1b, `docs/HANDOFF-M1b-comments.md`'s
  // 6b: "the meta row: branch status chip, Target: YYYY-MM-DD, and the
  // unresolved count") — `anchor_type = 'change'` counts key on the same
  // `anchor_id` (a branch's own id) regardless of anchor type, so the
  // batched RPC works unchanged here.
  const threadCountsState = useThreadCounts(
    modelId,
    branches.map((b) => b.id),
  );
  const threadCounts = threadCountsState.status === 'ready' ? threadCountsState.counts : undefined;
  // Item 3: affected capabilities + describeEnvelope one-liner, batched for
  // every card at once — see useChangeSummaries.ts's own comment.
  const summariesState = useChangeSummaries(modelId, branches);
  const summaries = summariesState.status === 'ready' ? summariesState.summaries : undefined;
  // Open changes by intent — each group's count adds up to the nav badge
  // (`countOpenChangeBranches`) — then merged, cancelled (S1 item 4) and
  // otherwise-closed changes in their own collapsed sections, the same
  // active/collapsed split `OrgHome.tsx` uses for archived models. An intent
  // group shows only when it has an open change, rather than four sections
  // where most read "nothing here" on a small model.
  // Project, then decision, then change (Simon, 2026-11-19): open changes sit under their decision and project; only a change in neither is listed on its own, in the sections below. Until the projects and decisions load, every change is listed on its own, as before.
  const hierarchyData = useChangesHierarchyData(modelId);
  const openBranches = branches.filter((b) => OPEN_CHANGE_STATUSES.includes(b.status));
  const hierarchy = hierarchyData ? buildChangesHierarchy(openBranches, hierarchyData.decisions, hierarchyData.projects, hierarchyData.options) : null;
  const standaloneIds = hierarchy ? new Set(hierarchy.standalone.map((b) => b.id)) : null;
  const { waitingForReview, openByIntent, merged, cancelled, closed } = groupChangesList(standaloneIds ? branches.filter((b) => !OPEN_CHANGE_STATUSES.includes(b.status) || standaloneIds.has(b.id)) : branches);
  // A standard change: start a "propose" change with a plain title, select it, then
  // open the screen that does the job on it (Retire panel, edit form, or the add box).
  const startGuided = ({ kind, system }: GuidedChangeStart) => {
    const title = kind === 'add' ? 'Add a new system' : kind === 'retire' ? `Retire ${system?.name ?? 'a system'}` : `Change details of ${system?.name ?? 'a system'}`;
    void createChange({ title, description: '', targetDate: '', intent: 'propose' }).then((branch) => {
      if (!branch) return;
      setRef({ kind: 'branch', branchId: branch.id });
      const base = `/o/${orgSlug}/m/${modelSlug}`;
      const refParam = `ref=branch:${branch.id}`;
      if (kind === 'add' || !system) void navigate(`${base}?${refParam}`);
      else void navigate(`${base}/e/${system.id}?${refParam}&action=${kind === 'retire' ? 'retire' : 'edit'}`);
    });
  };
  const hasOpen = openBranches.length > 0 || (hierarchyData?.options.length ?? 0) > 0;
  const endedSections = [
    { title: 'Merged', branches: merged },
    { title: 'Cancelled', branches: cancelled },
    { title: 'Rejected or archived', branches: closed },
  ];

  return (
    <div>
      {canCreate && (
        <Panel>
          <Text as="h2" size="lg">
            New change
          </Text>
          {mainHeadCommitId !== null && !aiOpen && (
            <GuidedChange modelId={modelId} commitId={mainHeadCommitId} busy={status === 'creating'} onStart={startGuided} />
          )}
          {aiEnabled && userId && (
            <DraftWithAi
              modelId={modelId}
              orgId={orgId}
              userId={userId}
              basePath={`/o/${orgSlug}/m/${modelSlug}`}
              commitId={mainHeadCommitId}
              onOpenChange={setAiOpen}
            />
          )}
          {!aiEnabled && (
            <Text as="p" tone="muted" size="sm">
              Draft with AI is off for this organisation.{' '}
              {isOwner ? (
                <>
                  Switch it on under Ask Atlas in <Link to={`/o/${orgSlug}/settings`}>organisation settings</Link>.
                </>
              ) : (
                'Ask an owner to switch it on.'
              )}
            </Text>
          )}
          {!aiOpen && (
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                void createChange({ title, description, targetDate, intent }).then((branch) => {
                  if (branch) {
                    setTitle('');
                    setDescription('');
                    setTargetDate('');
                    setIntent('propose');
                    // "The create-change flow lands you inside" — a freshly
                    // created change is always `draft`, so unlike
                    // `ChangePage.tsx`'s own "Edit in this change" there is no
                    // `canWorkInThisChange`-style gate to repeat here; select
                    // it as the active ref and go straight to its own page,
                    // same as clicking "Edit in this change" would.
                    setRef({ kind: 'branch', branchId: branch.id });
                    void navigate(`/o/${orgSlug}/m/${modelSlug}/changes/${branch.id}`);
                  }
                });
              }}
            >
              <input
                className={joinClasses(styles.input, styles.full)}
                type="text"
                aria-label="What's this change?"
                placeholder="What's this change? (e.g. Retire the legacy CRM)"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
                disabled={!mainHeadCommitId}
              />
              <textarea
                className={joinClasses(styles.textarea, styles.full)}
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                }}
                disabled={!mainHeadCommitId}
              />
              {/* Prompt pack F0: no fixed default for this one surface (see `intent`'s own state comment) — an explicit choice, always. */}
              <div className={styles.field}>
                <Text as="label" size="sm" tone="muted">
                  Why
                </Text>
                <select
                  className={styles.input}
                  value={intent}
                  onChange={(e) => {
                    const nextIntent = e.target.value as BranchIntent;
                    setIntent(nextIntent);
                    // A hidden field's stale value should never get submitted
                    // once the reviewer's own choice has hidden it away —
                    // matches `dateFieldLabelForIntent`'s own "correct/explore
                    // need no date at all".
                    if (dateFieldLabelForIntent(nextIntent) === null) setTargetDate('');
                  }}
                  disabled={!mainHeadCommitId}
                >
                  {NEW_CHANGE_INTENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {/* `explore` isn't offered above — see `NEW_CHANGE_INTENT_OPTIONS`'s
                  own doc comment: a candidate future is an option on a decision,
                  not a free-standing change. The hint names the real home rather
                  than silently hiding the fourth choice. */}
              <Text as="p" tone="muted" size="xs" className={styles.full}>
                Exploring candidate futures? Start a decision and add options there.
              </Text>
              {dateFieldLabel !== null && (
                <div className={styles.field}>
                  <Text as="label" size="sm" tone="muted">
                    {dateFieldLabel}
                  </Text>
                  <input
                    className={styles.input}
                    type="date"
                    value={targetDate}
                    onChange={(e) => {
                      setTargetDate(e.target.value);
                    }}
                    disabled={!mainHeadCommitId}
                  />
                </div>
              )}
              <div className={joinClasses(styles.formRow, styles.full)}>
                <Button variant="primary" type="submit" disabled={status === 'creating' || !mainHeadCommitId}>
                  {status === 'creating' ? 'Creating…' : 'Create change'}
                </Button>
              </div>
            </form>
          )}
          {!mainHeadCommitId && (
            <Text as="p" tone="muted" size="sm">
              This model has nothing on main yet — there is nothing to base a change on.
            </Text>
          )}
          {error !== null && <Text as="p">{error}</Text>}
        </Panel>
      )}

      <Text as="h2" size="lg">
        Changes
      </Text>
      {status === 'loading' && <Loading />}
      {/* Item 5: first-time explainer — the model has never had a change,
          not just "this page hasn't loaded any yet" (status !== 'loading'
          already distinguishes that from the ordinary empty-list case
          below). Keyed on every branch, not just the active ones — a model
          whose only changes are all cancelled has still "had a change"
          before, so the explainer would be a strange thing to show again;
          the empty state just below it is the one that's keyed on active
          only, since that's the one actually saying "nothing to see here." */}
      {branches.length === 0 && status !== 'loading' && (
        <Panel>
          <Text as="p" size="sm">
            A change is a proposed edit to the model that doesn&rsquo;t touch main until it&rsquo;s reviewed and merged.
          </Text>
          <Text as="p" size="sm">
            Contributors never edit main directly — every edit from a contributor goes through a change like this one.
          </Text>
          <Text as="p" size="sm">
            Merging a change updates the landscape, capability map and every view that reads main&rsquo;s current state.
          </Text>
          {/* Sprint 7i item 5: versions, in the same explainer — a version
              (Versions page) is an optional named snapshot of main for
              later comparison, never a step a change has to pass through
              on its way to being merged. */}
          <Text as="p" size="sm">
            Versions (tagging main for later comparison) are optional snapshots — a change never needs one to be reviewed or merged.
          </Text>
        </Panel>
      )}
      {branches.length === 0 && (hierarchyData?.options.length ?? 0) === 0 && status !== 'loading' && <EmptyState>No changes yet. {canCreate ? 'Create one above.' : 'Nobody has proposed one.'}</EmptyState>}
      {branches.length > 0 && !hasOpen && status !== 'loading' && <EmptyState>No open changes.{canCreate ? ' Create one above.' : ''}</EmptyState>}
      {hierarchy !== null && hierarchy.projects.length > 0 && (
        <CollapsibleSection title="In projects" meta={`(${String(hierarchy.projects.reduce((n, p) => n + p.changes.length + p.decisions.reduce((m, d) => m + d.options.length, 0), 0))})`}>
          <div data-testid="changes-in-projects">
            {hierarchy.projects.map(({ project, decisions: decisionBlocks, changes }) => (
              <div key={project.id} className={styles.group}>
                <Text as="h3" size="md">
                  <Link to={`/o/${orgSlug}/m/${modelSlug}/projects/${project.id}`}>{project.title}</Link>
                </Text>
                {decisionBlocks.map((block) => (
                  <DecisionGroup key={block.decision.id} block={block} orgSlug={orgSlug} modelSlug={modelSlug} threadCounts={threadCounts} summaries={summaries} />
                ))}
                {changes.length > 0 && (
                  <ul className={styles.list}>
                    {changes.map((branch) => (
                      <ChangeRow key={branch.id} branch={branch} orgSlug={orgSlug} modelSlug={modelSlug} unresolvedCount={threadCounts?.get(branch.id)?.open} summary={summaries?.get(branch.id)} />
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
      {hierarchy !== null && hierarchy.decisions.length > 0 && (
        <CollapsibleSection title="In decisions" meta={`(${String(hierarchy.decisions.reduce((n, d) => n + d.options.length, 0))})`}>
          <div data-testid="changes-in-decisions">
            {hierarchy.decisions.map((block) => (
              <DecisionGroup key={block.decision.id} block={block} orgSlug={orgSlug} modelSlug={modelSlug} threadCounts={threadCounts} summaries={summaries} />
            ))}
          </div>
        </CollapsibleSection>
      )}
      {waitingForReview.length > 0 && (
        <CollapsibleSection title="Waiting for review" meta={`(${String(waitingForReview.length)})`}>
          <ul className={styles.list}>
            {waitingForReview.map((branch) => (
              <ChangeRow
                key={branch.id}
                branch={branch}
                orgSlug={orgSlug}
                modelSlug={modelSlug}
                unresolvedCount={threadCounts?.get(branch.id)?.open}
                summary={summaries?.get(branch.id)}
              />
            ))}
          </ul>
        </CollapsibleSection>
      )}
      {openByIntent.map(
        ({ intent, branches: group }) =>
          group.length > 0 && (
            <CollapsibleSection key={intent} title={INTENT_LABEL[intent]} meta={`(${String(group.length)})`}>
              <ul className={styles.list}>
                {group.map((branch) => (
                  <ChangeRow
                    key={branch.id}
                    branch={branch}
                    orgSlug={orgSlug}
                    modelSlug={modelSlug}
                    unresolvedCount={threadCounts?.get(branch.id)?.open}
                    summary={summaries?.get(branch.id)}
                  />
                ))}
              </ul>
            </CollapsibleSection>
          ),
      )}

      {endedSections.map(
        ({ title, branches: group }) =>
          group.length > 0 && (
            <CollapsibleSection key={title} title={title} meta={`(${String(group.length)})`} defaultOpen={false}>
              <ul className={styles.list}>
                {group.map((branch) => (
                  <ChangeRow
                    key={branch.id}
                    branch={branch}
                    orgSlug={orgSlug}
                    modelSlug={modelSlug}
                    unresolvedCount={threadCounts?.get(branch.id)?.open}
                    summary={summaries?.get(branch.id)}
                  />
                ))}
              </ul>
            </CollapsibleSection>
          ),
      )}
    </div>
  );
}

/** One decision with its option changes beneath it. */
function DecisionGroup({
  block,
  orgSlug,
  modelSlug,
  threadCounts,
  summaries,
}: {
  block: DecisionBlock;
  orgSlug: string;
  modelSlug: string;
  threadCounts: ReadonlyMap<string, { open: number }> | undefined;
  summaries: ReadonlyMap<string, ChangeListSummary> | undefined;
}) {
  return (
    <div className={styles.group}>
      <Text as="h4" size="sm" tone="muted">
        Decision: <Link to={`/o/${orgSlug}/m/${modelSlug}/decisions/${block.decision.id}`}>{block.decision.title}</Link>
      </Text>
      <ul className={styles.list}>
        {block.options.map((item) => item.branch !== null ? (
          <ChangeRow key={item.id} branch={item.branch} orgSlug={orgSlug} modelSlug={modelSlug} unresolvedCount={threadCounts?.get(item.branch.id)?.open} summary={summaries?.get(item.branch.id)} />
        ) : (
          <li key={item.id} className={styles.row}>
            <div className={styles.rowText}>
              <Link to={`/o/${orgSlug}/m/${modelSlug}/decisions/${block.decision.id}`}>
                <Text as="span" size="lg">{item.title}</Text>
              </Link>
              <div className={styles.rowMeta}>
                <Chip tone="neutral">candidate</Chip>
                <Text as="span" tone="faint" size="xs">No delivery change yet</Text>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChangeRow({
  branch,
  orgSlug,
  modelSlug,
  unresolvedCount,
  summary,
}: {
  branch: BranchRow;
  orgSlug: string;
  modelSlug: string;
  unresolvedCount: number | undefined;
  /** `undefined` while `useChangeSummaries` is still loading, or if it failed — the card renders without this row rather than a loading placeholder for a nice-to-have. */
  summary: ChangeListSummary | undefined;
}) {
  const intent = branch.intent ?? 'propose';
  const dateFieldLabel = dateFieldLabelForIntent(intent);
  const impact = summary ? focusImpact(summary.affectedCapabilities, summary.affectedValueStreams, summary.projectScopeIds) : null;
  return (
    <li className={styles.row}>
      <div className={styles.rowText}>
        <Text as="span" size="lg">
          {branch.title ?? branch.name}
        </Text>
        {branch.description !== null && (
          <Text as="p" tone="muted" size="sm">
            {branch.description}
          </Text>
        )}
        {/* S1 item 4: "listed under a collapsed 'Cancelled' section with a
            reason" — the reason belongs right here in the list, not only
            on the change's own page. */}
        {branch.status === 'cancelled' && branch.cancel_reason && (
          <Text as="p" tone="muted" size="sm">
            Cancelled: {cancelReasonText(branch.cancel_reason)}
          </Text>
        )}
        {/* Item 3's own one-liner — distinct from the free-text description
            above: what this change actually *does*, derived from its own
            deltas, not what its author typed. */}
        {summary && summary.description !== 'No changes yet' && (
          <Text as="p" tone="muted" size="sm">
            {summary.description}
          </Text>
        )}
        <div className={styles.rowMeta}>
          {/* Redundant with the section this row lives under while active
              (grouped by intent above), but the one place this chip earns
              its keep is the flat "Cancelled" section below, which mixes
              every intent together with no grouping of its own. */}
          <Chip tone="neutral">{INTENT_LABEL[intent]}</Chip>
          <Chip tone={branchStatusTone(branch.status)}>{branch.status}</Chip>
          {dateFieldLabel !== null && branch.target_date !== null && (
            <Text as="span" tone="faint" size="xs">
              {dateFieldLabel}: {branch.target_date}
            </Text>
          )}
          {/* Only the "has unresolved" state is real data — see
              `docs/SPEC-data-model.md` §11's "hollow marker" row for why a
              muted "all resolved" state isn't distinguishable from "no
              comments at all" with today's RPC, and isn't faked here. */}
          {unresolvedCount !== undefined && unresolvedCount > 0 ? (
            <Text as="span" tone="faint" size="xs">
              💬 {unresolvedCount} unresolved
            </Text>
          ) : (
            <Text as="span" tone="muted" size="xs">
              no comments
            </Text>
          )}
        </div>
        {impact && impact.shownCapabilities.length > 0 && (
          <ul className={styles.affectedCapabilities}>
            {impact.shownCapabilities.map(({ capability }) => (
              <li key={capability.element_id}>
                <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${capability.element_id}`} className={styles.affectedCapabilityLink}>
                  <ElementTypeGlyph type="capability" />
                  <Text as="span" size="sm">
                    {capability.name}
                  </Text>
                </Link>
              </li>
            ))}
            {impact.collapsedCapabilities.length > 0 && (
              <li>
                <Text as="span" tone="muted" size="sm">
                  +{impact.collapsedCapabilities.length} more outside the project&apos;s scope
                </Text>
              </li>
            )}
          </ul>
        )}
        {/* F6/ADR-023: same compact glyph+name+link shape as the capabilities
            list above, stream-only — this card list has no room for the
            fuller stage/capability breakdown `ChangeView.tsx`'s own panel
            gives. */}
        {impact && impact.shownValueStreams.length > 0 && (
          <ul className={styles.affectedCapabilities}>
            {impact.shownValueStreams.map(({ stream }) => (
              <li key={stream.element_id}>
                <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${stream.element_id}`} className={styles.affectedCapabilityLink}>
                  <ElementTypeGlyph type="value_stream" />
                  <Text as="span" size="sm">
                    {stream.name}
                  </Text>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/changes/${branch.id}`} variant="secondary" className={styles.rowAction}>
        Open →
      </LinkButton>
    </li>
  );
}
