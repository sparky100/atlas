import { cancelReasonText } from './cancelReasonText';
import { Loading } from '../components/Loading/Loading';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { CommentsSection } from '../components/CommentsSection/CommentsSection';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { LinkButton } from '../components/Button/LinkButton';
import { PageIdentity } from '../components/PageIdentity/PageIdentity';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { createChangeBranch, getMainBranch } from '../../db/branches';
import { citationsToNames } from '../../db/designAgent';
import type { AffectedCapability, ChangeAffectedValueStream } from '../../db/changeSummary';
import type { MemberRole, SourceRow } from '../../db/types';
import { useSelectedRef } from '../branches/useSelectedRef';
import { formatDateTime } from '../time';
import { canApproveOrMergeRequest, canCancelChange } from '../orgs/useMembership';
import { BranchRebasePanel } from '../reviews/BranchRebasePanel';
import { supabase } from '../supabaseClient';
import { refQueryParam } from '../../db/ref';
import { ElementNamedText } from './ElementNamedText';
import { OptionAiMark } from './OptionAiMark';
import { optionKindOf } from './optionDraftActions';
import { OptionDraftCard } from './OptionDraftCard';
import { ChangeImpactPreview } from './ChangeImpactPreview';
import { dateFieldLabelForIntent, intentReviewWeight, isDateRequiredForIntent } from './branchIntent';
import { branchStatusTone } from './branchStatus';
import { deriveChangeStep } from './changeStepper';
import { describeDelta } from './changeSummaryFormat';
import { hasImpactProblems } from './hasImpactProblems';
import { ImpactProblemsPanel } from './ImpactProblemsPanel';
import { describeImpactReasons, describeValueStreamReasons, focusImpact } from './impactFocus';
import { Stepper } from './Stepper/Stepper';
import { useApproveAndMerge } from './useApproveAndMerge';
import { useCancelChange } from './useCancelChange';
import { useChange } from './useChange';
import { useChangeSummary } from './useChangeSummary';
import { useImportSummary } from './useImportSummary';
import { useOpenMergeRequest } from './useOpenMergeRequest';
import { useSubmitForReview } from './useSubmitForReview';
import { ReviewerPicker } from './ReviewerPicker';
import styles from './ChangeView.module.css';

/** A stable identity for `useImportSummary`'s own `sourcesById` before `useChangeSummary` has loaded — a fresh `new Map()` literal every render would retrigger that hook's load effect every render for no reason. */
const EMPTY_SOURCES_BY_ID: ReadonlyMap<UUID, SourceRow> = new Map();

export interface ChangeViewProps {
  orgId: UUID;
  modelId: UUID;
  branchId: UUID;
  orgSlug: string;
  modelSlug: string;
  role: MemberRole | null;
  /** Contributor+ (ADR-009) — the same gate `ChangesView`'s create form uses; a viewer sees the change read-only. */
  canEdit: boolean;
  /** The page title line (the change's own "why" and name), drawn in the header with the actions. */
  heading: string;
  /** Where the change came from and which project it belongs to, drawn first under "about this change". */
  aboutExtras?: ReactNode;
}

/**
 * A single change's own page (Sprint C1 step 3, UI-principles §2.4's
 * `/changes/{branchSlug}` route — routed on the branch's real id here,
 * since `branches` has no separate slug column of its own to route on,
 * unlike `organisations`/`models`).
 *
 * Sprint C1 step 6 fills in the sections step 3 left as honest
 * placeholders: this change's own deltas grouped by element/relationship,
 * the capabilities it affects via `supports`, other open changes touching
 * the same subjects, and the delivered/remaining lineage (ADR-006
 * amendment — real once the review queue's split mechanic exists to
 * produce one; empty and said so until then).
 *
 * Sprint C1 step 7 adds the one merge action that belongs on the change
 * page itself: submitting a draft for review (`draft -> proposed`,
 * SPEC §3.4). Everything else the review queue does (refresh, resolve,
 * approve, merge) lives on the review request's own page
 * (src/ui/reviews/ReviewRequestView.tsx) once a request exists — this page
 * only ever links to it.
 *
 * Sprint C1 step 8 adds a "rebase on main" panel (the user's brief:
 * "Rebase branch on new main head with conflict surfacing") for a draft
 * change that hasn't been submitted yet — so a long-lived branch can pull
 * in main and see conflicts long before review, not just discover it's
 * behind when it finally gets there. It's shown only while there is no
 * open merge request: once one exists, refreshing goes through the review
 * request's own page instead (it also has to resubmit the request's
 * cached classification, which this panel has no request to update).
 *
 * Leaving vs finishing (`EditingBranchBanner.tsx`'s own "Back to main" is
 * the other half): "Submit for review" is *finishing*, not leaving — the
 * branch itself goes read-only for the proposer (`draft -> proposed`), so
 * unlike "Back to main" there is no state left to preserve by staying
 * selected. Submitting therefore clears the session's active ref too, but
 * only when this branch was actually the one selected — never a bystander
 * reviewer's own selection just because they happened to look at this page.
 */

/** How many subjects to show in "Edits on this change" before collapsing behind "View more" — same pattern as CaptureJobListView.tsx's own PAGE_SIZE, for the identical reason: a capture-driven change can carry hundreds of edits. */
const EDITED_SUBJECTS_PAGE_SIZE = 20;

export function ChangeView({ orgId, modelId, branchId, orgSlug, modelSlug, role, canEdit, heading, aboutExtras }: ChangeViewProps) {
  const { userId } = useAuth();
  const { status, branch, error, updateMetadata, reload } = useChange(branchId);
  const summaryState = useChangeSummary(modelId, branch);
  const impact = summaryState.status === 'ready' ? focusImpact(summaryState.summary.affectedCapabilities, summaryState.summary.affectedValueStreams, summaryState.summary.projectScopeIds) : null;
  const importSourcesById = summaryState.status === 'ready' ? summaryState.summary.sourcesById : EMPTY_SOURCES_BY_ID;
  const importSummary = useImportSummary(orgId, modelId, branch, importSourcesById, userId, reload);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const navigate = useNavigate();
  const { request: openRequest, reload: reloadOpenRequest } = useOpenMergeRequest(branchId);
  const submission = useSubmitForReview(modelId, branch);
  const approveAndMergeState = useApproveAndMerge(modelId);
  const cancellation = useCancelChange(branch);
  const { ref, setRef, clearRef } = useSelectedRef();
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [pickingReviewers, setPickingReviewers] = useState(false);
  const [visibleSubjectCount, setVisibleSubjectCount] = useState(EDITED_SUBJECTS_PAGE_SIZE);

  if (status === 'loading') return <Loading />;
  if (status === 'not_found' || !branch) return <Text as="p">No change found for this id.</Text>;

  // Prompt pack F0: `branch.intent` is only ever `null` for a change branch
  // that predates the migration backfilling everything else to `propose` —
  // real data always has one, but this view falls back the same way
  // `duplicateIntoNewDraft` already does, rather than making every read
  // below handle a `null` it should never actually see.
  const intent = branch.intent ?? 'propose';
  const dateFieldLabel = dateFieldLabelForIntent(intent);
  // F3a: propose/explore carry a reviewer set at submit; record/correct stay
  // on the single-approver path (no picker).
  const isMultiReviewerIntent = intent === 'propose' || intent === 'explore';

  const afterSubmitted = (mergeRequestId: UUID) => {
    // Leaving vs finishing: "Back to main" leaves a still-editable Draft;
    // "Submit for review" finishes it — the branch becomes read-only for the
    // proposer the moment it's Proposed (canEditBranch's own
    // `status === 'draft'` gate), so there is nothing left to be "in." Only
    // clear the session's active ref if this branch was actually it — a
    // reviewer or bystander submitting from a change page they weren't
    // editing in has nothing to reset.
    if (ref.kind === 'branch' && ref.branchId === branchId) clearRef();
    void navigate(`/o/${orgSlug}/m/${modelSlug}/review/${mergeRequestId}`);
  };

  const duplicateIntoNewDraft = async () => {
    setDuplicateError(null);
    setDuplicating(true);
    try {
      const main = await getMainBranch(supabase, modelId);
      if (!main) {
        setDuplicateError('This model has nothing in it yet, so there is nothing to base a change on.');
        return;
      }
      const newBranch = await createChangeBranch(supabase, {
        id: crypto.randomUUID(),
        orgId,
        modelId,
        name: `${branch.name}-copy-${crypto.randomUUID().slice(0, 8)}`,
        ...(branch.title ? { title: citationsToNames(branch.title, {}) } : {}),
        ...(branch.description ? { description: citationsToNames(branch.description, {}) } : {}),
        ...(branch.target_date ? { targetDate: branch.target_date } : {}),
        createdBy: userId ?? '',
        mainHeadCommitId: main.head_commit_id,
        // Prompt pack F0: a duplicate keeps its source branch's own intent
        // — `branch.intent` is only ever `null` for a non-`change` kind,
        // which this action never duplicates from, but the fallback keeps
        // this call exhaustive over `BranchIntent` regardless.
        intent: branch.intent ?? 'propose',
      });
      // Same "lands you inside, editing" convention `ChangesView.tsx`'s own
      // create form already establishes — a duplicate is a fresh draft the
      // proposer presumably wants to pick straight back up, not just view.
      setRef({ kind: 'branch', branchId: newBranch.id });
      void navigate(`/o/${orgSlug}/m/${modelSlug}/changes/${newBranch.id}`);
    } catch (e) {
      setDuplicateError(e instanceof Error ? e.message : 'Could not duplicate this change.');
    } finally {
      setDuplicating(false);
    }
  };

  const startEditing = () => {
    setTitle(citationsToNames(branch.title ?? '', {}));
    setDescription(citationsToNames(branch.description ?? '', {}));
    setTargetDate(branch.target_date ?? '');
    setEditing(true);
  };

  const isSelected = ref.kind === 'branch' && ref.branchId === branchId;
  const summaryReady = summaryState.status === 'ready';
  const hasEdits = summaryReady && summaryState.summary.subjects.length > 0;
  const canSubmit = canEdit && branch.status === 'draft' && openRequest === null;
  // One clear main action for the stage the change is in.
  // An "explore" change is an option of a decision, not a change proposal: it leads with what it is and one way to start,
  // and review (submit, the approval track) only appears once it has edits to review.
  const isOption = branch.intent === 'explore';
  // "Keep and tidy up" and "Configure what we already run" often change nothing in the model; say so rather than imply something is missing.
  const optionKind = isOption ? optionKindOf(branch.title ?? branch.name) : null;
  const noLandscapeChange = optionKind === 'keep' || optionKind === 'configure';
  const showSubmit = canSubmit && (!isOption || hasEdits);
  const submitIsPrimary = canSubmit && hasEdits;
  const editIsPrimary = canEdit && branch.status === 'draft' && !isSelected && !submitIsPrimary;
  const oneStepApprove = openRequest && intentReviewWeight(intent) === 'single' && canApproveOrMergeRequest(role) && (openRequest.status === 'pending' || openRequest.status === 'approved');
  const editInLandscapeHref = `/o/${orgSlug}/m/${modelSlug}/landscape?${refQueryParam({ kind: 'branch', branchId }, false)}`;
  const impactHasContent =
    summaryReady &&
    impact !== null &&
    (hasImpactProblems(summaryState.summary.impactProblems) ||
      impact.shownCapabilities.length + impact.collapsedCapabilities.length + impact.shownValueStreams.length + impact.collapsedValueStreams.length > 0 ||
      summaryState.summary.otherOpenChanges.length > 0 ||
      summaryState.summary.captureDraftOverlaps.length > 0);

  return (
    <div>
      {/* Actions: the title, where the change stands, and the one thing to do next. */}
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.headerTitle}>
            <PageIdentity kind="Change" name={isOption ? (branch.title ?? branch.name) : heading} />
            {isOption && (
              <Text as="p" tone="muted" size="sm">
                An option for the decision. Nothing in the model changes unless the decision chooses this option and its changes are approved.
              </Text>
            )}
            <div className={styles.meta}>
              <Chip tone={branchStatusTone(branch.status)}>{branch.status}</Chip>
              {dateFieldLabel !== null && branch.target_date !== null && (
                <Text as="span" tone="muted" size="sm">
                  {dateFieldLabel}: {branch.target_date}
                </Text>
              )}
              <Text as="span" tone="faint" size="xs">
                Updated {formatDateTime(branch.updated_at)}
              </Text>
            </div>
          </div>
          <div className={styles.headerActions}>
            {isOption && canEdit && branch.status === 'draft' && (
              <LinkButton to={editInLandscapeHref} variant={isSelected ? 'primary' : 'secondary'}>
                {hasEdits ? 'Carry on editing' : "Draft this option's changes"}
              </LinkButton>
            )}
            {!isOption && canEdit && branch.status === 'draft' && (
              <Button
                variant={editIsPrimary ? 'primary' : 'secondary'}
                disabled={isSelected}
                onClick={() => {
                  setRef({ kind: 'branch', branchId });
                }}
              >
                {isSelected ? 'Editing in this change' : 'Edit in this change'}
              </Button>
            )}
            {showSubmit && (
              <Button
                variant={submitIsPrimary ? 'primary' : 'secondary'}
                disabled={submission.status === 'submitting'}
                onClick={() => {
                  if (isMultiReviewerIntent) {
                    setPickingReviewers(true);
                  } else {
                    void submission.submit(null).then((mergeRequestId) => {
                      if (!mergeRequestId) return;
                      afterSubmitted(mergeRequestId);
                    });
                  }
                }}
              >
                {submission.status === 'submitting' ? 'Submitting…' : 'Submit for review'}
              </Button>
            )}
            {oneStepApprove && (
              <Button
                variant="primary"
                disabled={approveAndMergeState.status === 'working'}
                onClick={() => {
                  void approveAndMergeState.approveAndMerge(openRequest, branch).then((merged) => {
                    if (!merged) return;
                    reload();
                    reloadOpenRequest();
                  });
                }}
              >
                {approveAndMergeState.status === 'working' ? 'Merging…' : 'Approve & merge'}
              </Button>
            )}
            {openRequest && (
              <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/review/${openRequest.id}`} variant={oneStepApprove ? 'secondary' : 'primary'}>
                Open review →
              </LinkButton>
            )}
            {!isOption && (
              <Link to={`/o/${orgSlug}/m/${modelSlug}/landscape?${refQueryParam({ kind: 'branch', branchId }, true)}`}>
                <Button variant="secondary">View this change</Button>
              </Link>
            )}
            {canEdit && branch.status === 'draft' && !editing && (
              <Button variant="ghost" onClick={startEditing}>
                Edit title and description
              </Button>
            )}
            {canCancelChange(role, branch, userId) && !cancelling && (
              <Button
                variant="destructive"
                onClick={() => {
                  setCancelReason('');
                  setCancelling(true);
                }}
              >
                {isOption ? 'Remove this option…' : 'Cancel this change…'}
              </Button>
            )}
          </div>
        </div>
        {/* The stepper needs to know whether an open merge request exists;
            `undefined` means still loading, so it waits rather than rendering
            with a momentarily-wrong "no request" assumption. */}
        {openRequest !== undefined && !(isOption && branch.status === 'draft' && openRequest === null) && <Stepper derived={deriveChangeStep(branch, openRequest)} />}
        {pickingReviewers && (
          <ReviewerPicker
            orgId={orgId}
            modelId={modelId}
            branch={branch}
            submitting={submission.status === 'submitting'}
            onCancel={() => {
              setPickingReviewers(false);
            }}
            onSubmit={(reviewers) => {
              void submission.submit(reviewers).then((mergeRequestId) => {
                if (!mergeRequestId) return;
                setPickingReviewers(false);
                afterSubmitted(mergeRequestId);
              });
            }}
          />
        )}
        {submission.error !== null && <Text as="p">{submission.error}</Text>}
        {approveAndMergeState.error !== null && <Text as="p">{approveAndMergeState.error}</Text>}
        {error !== null && <Text as="p">{error}</Text>}
        {cancelling && (
          <div className={styles.editForm}>
            <textarea
              className={styles.textarea}
              placeholder="Reason (required)"
              value={cancelReason}
              onChange={(e) => {
                setCancelReason(e.target.value);
              }}
            />
            <div className={styles.actions}>
              <Button
                variant="destructive"
                disabled={cancellation.status === 'cancelling'}
                onClick={() => {
                  void cancellation.cancel(cancelReason).then((cancelled) => {
                    if (!cancelled) return;
                    setCancelling(false);
                    if (ref.kind === 'branch' && ref.branchId === branchId) clearRef();
                    reload();
                  });
                }}
              >
                {cancellation.status === 'cancelling' ? 'Cancelling…' : 'Confirm cancel'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setCancelling(false);
                }}
              >
                Back
              </Button>
            </div>
            {cancellation.error !== null && <Text as="p">{cancellation.error}</Text>}
          </div>
        )}
      </div>

      {branch.status === 'cancelled' && (
        <Panel>
          <Text as="p" size="sm">
            Cancelled{branch.cancelled_at ? ` ${formatDateTime(branch.cancelled_at)}` : ''}.
          </Text>
          {branch.cancel_reason && (
            <Text as="p" tone="muted" size="sm">
              {cancelReasonText(branch.cancel_reason)}
            </Text>
          )}
          <Button variant="secondary" disabled={duplicating} onClick={() => void duplicateIntoNewDraft()}>
            {duplicating ? 'Duplicating…' : 'Duplicate into a new draft'}
          </Button>
          {duplicateError !== null && <Text as="p">{duplicateError}</Text>}
        </Panel>
      )}

      {/* Only appears when the model has moved on (or an edit needs a decision). */}
      {branch.status === 'draft' && openRequest === null && <BranchRebasePanel modelId={modelId} branch={branch} userId={userId} canEdit={canEdit} onRebased={reload} />}

      {summaryState.status === 'ready' && hasEdits && !['merged', 'cancelled', 'rejected', 'archived'].includes(branch.status) && (
        <ChangeImpactPreview modelId={modelId} branch={branch} affectedCapabilities={summaryState.summary.affectedCapabilities} base={`/o/${orgSlug}/m/${modelSlug}`} />
      )}

      <div className={impactHasContent ? styles.layout : styles.layoutSingle}>
        {/* Change information */}
        <div className={styles.column}>
          {aboutExtras}

          {!editing ? (
            (branch.description !== null || (canEdit && branch.status === 'draft')) && (
              <Panel>
                <div className={styles.field}>
                  <Text as="h2" size="lg">
                    Description
                  </Text>
                  <Text as="p" tone={branch.description ? 'default' : 'muted'}>
                    {branch.description !== null ? <ElementNamedText text={branch.description} commitId={branch.head_commit_id} /> : 'Add a short description so reviewers know why.'}
                  </Text>
                  {isOption && <OptionAiMark orgId={orgId} branchId={branchId} />}
                </div>
              </Panel>
            )
          ) : (
            <Panel>
              <form
                className={styles.editForm}
                onSubmit={(e) => {
                  e.preventDefault();
                  void updateMetadata({
                    title: title.trim().length > 0 ? title.trim() : null,
                    description: description.trim().length > 0 ? description.trim() : null,
                    // `correct`/`explore` have no date field at all (see
                    // `dateFieldLabelForIntent`) — omitted from the patch entirely,
                    // not sent as `null`, so an unrelated edit never clears a date.
                    ...(dateFieldLabel !== null ? { targetDate: targetDate.trim().length > 0 ? targetDate.trim() : null } : {}),
                  }).then(() => {
                    setEditing(false);
                  });
                }}
              >
                <input
                  className={styles.input}
                  type="text"
                  placeholder="Title"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                  }}
                />
                <textarea
                  className={styles.textarea}
                  placeholder="Description"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                  }}
                />
                {dateFieldLabel !== null && (
                  <div className={styles.dateField}>
                    <Text as="label" size="sm" tone="muted">
                      {dateFieldLabel}
                      {isDateRequiredForIntent(intent) ? ' (required)' : ''}
                    </Text>
                    <input
                      className={styles.input}
                      type="date"
                      required={isDateRequiredForIntent(intent)}
                      value={targetDate}
                      onChange={(e) => {
                        setTargetDate(e.target.value);
                      }}
                    />
                  </div>
                )}
                <div className={styles.actions}>
                  <Button variant="primary" type="submit" disabled={status === 'saving'}>
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setEditing(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </Panel>
          )}

          {importSummary.state.status !== 'none' && (
            <Panel>
              <Text as="h2" size="lg">
                Import summary
              </Text>
              {importSummary.state.status === 'loading' && <Loading />}
              {importSummary.state.status === 'error' && <Text as="p">{importSummary.state.message}</Text>}
              {importSummary.state.status === 'ready' && (
                <>
                  <Text as="p" size="sm" tone="muted">
                    From {importSummary.state.fileName}
                  </Text>
                  <div className={styles.importCounts}>
                    <Chip tone="neutral">{summaryState.status === 'ready' ? summaryState.summary.subjects.filter((s) => s.subjectType === 'element' && (s.elementType === 'system' || s.elementType === 'container') && s.deltas.some((d) => d.kind === 'element.create')).length : 0} new</Chip>
                    <Chip tone="neutral">{summaryState.status === 'ready' ? summaryState.summary.subjects.filter((s) => s.subjectType === 'element' && (s.elementType === 'system' || s.elementType === 'container') && !s.deltas.some((d) => d.kind === 'element.create')).length : 0} changed</Chip>
                    {importSummary.state.notInFile.length > 0 && <Chip tone="warn">{importSummary.state.notInFile.length} not in file</Chip>}
                  </div>
                  {importSummary.state.notInFile.length > 0 && (
                    <ul className={styles.subjectList}>
                      {importSummary.state.notInFile.map((element) => (
                        <li key={element.elementId} className={styles.subjectRow}>
                          <div className={styles.subjectTitle}>
                            <ElementTypeGlyph type={element.elementType} />
                            <Text as="span" size="lg">
                              {element.name}
                            </Text>
                          </div>
                          {canEdit && (
                            <Button variant="secondary" disabled={importSummary.retiring === element.elementId} onClick={() => { void importSummary.retire(element); }}>
                              {importSummary.retiring === element.elementId ? 'Retiring…' : 'Retire'}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </Panel>
          )}

          {summaryState.status === 'loading' && (
            <Panel>
              <Loading />
            </Panel>
          )}
          {summaryState.status === 'error' && (
            <Panel>
              <Text as="p">{summaryState.message}</Text>
            </Panel>
          )}
          {summaryState.status === 'ready' && summaryState.summary.subjects.length === 0 && importSummary.state.status === 'none' && canEdit && branch.status === 'draft' && (
            <div className={styles.nextStep}>
              {noLandscapeChange ? (
                <>
                  <Text as="p" size="lg">
                    No change to the landscape recorded.
                  </Text>
                  <Text as="p" tone="muted" size="sm">
                    This option works with what we already run, so it may need no change to the model. If it does, open a system, make your edit and save it, and it will appear here, together with what it affects.
                  </Text>
                </>
              ) : (
                <>
                  <Text as="p" size="lg">
                    Nothing has been changed yet.
                  </Text>
                  <Text as="p" tone="muted" size="sm">
                    Open a system, make your edit and save it. It will appear here, together with what it affects.
                  </Text>
                </>
              )}
              <OptionDraftCard branch={branch} mainHeadCommitId={branch.head_commit_id} orgSlug={orgSlug} modelSlug={modelSlug} />
              <LinkButton to={editInLandscapeHref} variant={isSelected ? 'primary' : 'secondary'}>
                {isSelected ? 'Carry on editing' : 'Open the landscape to edit'}
              </LinkButton>
            </div>
          )}
          {summaryState.status === 'ready' && summaryState.summary.subjects.length > 0 && (
            <Panel>
              <Text as="h2" size="lg">
                What this change does
              </Text>
              <ul className={styles.subjectList}>
                {summaryState.summary.subjects.slice(0, visibleSubjectCount).map((subject) => (
                  <li key={subject.subjectId} className={styles.subjectRow}>
                    <div className={styles.subjectTitle}>
                      {subject.subjectType === 'element' && <ElementTypeGlyph type={subject.elementType} />}
                      <Text as="span" size="lg">
                        {subject.name}
                      </Text>
                    </div>
                    <ul className={styles.deltaList}>
                      {subject.deltas.map((delta) => {
                        const source = summaryState.summary.sourcesById.get(delta.sourceId);
                        return (
                          <li key={delta.id} className={styles.deltaRow}>
                            <Text as="span" size="sm">
                              {describeDelta(delta)}
                            </Text>
                            <Text as="span" tone="muted" size="sm">
                              {source?.name ?? delta.sourceId}
                            </Text>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
              {summaryState.summary.subjects.length > visibleSubjectCount && (
                <Button variant="ghost" onClick={() => { setVisibleSubjectCount((c) => c + EDITED_SUBJECTS_PAGE_SIZE); }}>
                  View more ({summaryState.summary.subjects.length - visibleSubjectCount} more)
                </Button>
              )}
            </Panel>
          )}

          <Panel>
            <Text as="h2" size="lg">
              Comments
            </Text>
            <CommentsSection orgId={orgId} modelId={modelId} userId={userId} role={role} anchorType="change" anchorId={branchId} branchId={branchId} />
          </Panel>

          {summaryState.status === 'ready' && summaryState.lineage.splits.length > 0 && (
            <Panel>
              <Text as="h2" size="lg">
                Parts of this change
              </Text>
              <ul className={styles.branchList}>
                {summaryState.lineage.splits.map((split) => (
                  <li key={split.id} className={styles.branchRow}>
                    <div className={styles.branchText}>
                      <Text as="span">{split.title ?? split.name}</Text>
                    </div>
                    <div className={styles.branchActions}>
                      <Chip tone={branchStatusTone(split.status)}>{split.status === 'merged' ? 'delivered' : split.status}</Chip>
                      <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/changes/${split.id}`} variant="secondary">
                        Open →
                      </LinkButton>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {summaryState.status === 'ready' && summaryState.lineage.splits.length === 0 && branch.split_from && (
            <Text as="p" tone="muted" size="sm">
              This change was taken out of a larger change.
            </Text>
          )}
        </div>

        {/* Change impact: only when there is something to say, problems first. */}
        {impactHasContent && (
          <div className={styles.column}>
            <ImpactProblemsPanel problems={summaryState.summary.impactProblems} orgSlug={orgSlug} modelSlug={modelSlug} />

            {impact.shownCapabilities.length + impact.collapsedCapabilities.length > 0 && (
              <Panel>
                <Text as="h2" size="lg">
                  Affected capabilities
                </Text>
                {impact.focused && (
                  <Text as="p" tone="muted" size="sm">
                    In this project&apos;s declared scope.
                  </Text>
                )}
                {impact.shownCapabilities.length > 0 && <AffectedCapabilityList capabilities={impact.shownCapabilities} orgSlug={orgSlug} modelSlug={modelSlug} />}
                {impact.collapsedCapabilities.length > 0 && (
                  <CollapsibleSection title="Also reached, outside the project's scope" meta={`(${String(impact.collapsedCapabilities.length)})`} defaultOpen={false}>
                    <AffectedCapabilityList capabilities={impact.collapsedCapabilities} orgSlug={orgSlug} modelSlug={modelSlug} />
                  </CollapsibleSection>
                )}
              </Panel>
            )}

            {impact.shownValueStreams.length + impact.collapsedValueStreams.length > 0 && (
              <Panel>
                <Text as="h2" size="lg">
                  Affected value streams
                </Text>
                {impact.shownValueStreams.length > 0 && <AffectedValueStreamList valueStreams={impact.shownValueStreams} orgSlug={orgSlug} modelSlug={modelSlug} />}
                {impact.collapsedValueStreams.length > 0 && (
                  <CollapsibleSection title="Also reached, outside the project's scope" meta={`(${String(impact.collapsedValueStreams.length)})`} defaultOpen={false}>
                    <AffectedValueStreamList valueStreams={impact.collapsedValueStreams} orgSlug={orgSlug} modelSlug={modelSlug} />
                  </CollapsibleSection>
                )}
              </Panel>
            )}

            {(summaryState.summary.otherOpenChanges.length > 0 || summaryState.summary.captureDraftOverlaps.length > 0) && (
              <Panel>
                <Text as="h2" size="lg">
                  Other open changes touching the same elements
                </Text>
                {summaryState.summary.otherOpenChanges.length > 0 && (
                  <ul className={styles.branchList}>
                    {summaryState.summary.otherOpenChanges.map(({ branch: other, sharedElementNames }) => (
                      <li key={other.id} className={styles.branchRow}>
                        <div className={styles.branchText}>
                          <Text as="span">{other.title ?? other.name}</Text>
                          <Text as="p" tone="muted" size="sm">
                            Both touch {sharedElementNames.join(', ')}
                          </Text>
                        </div>
                        <div className={styles.branchActions}>
                          <Chip tone={branchStatusTone(other.status)}>{other.status}</Chip>
                          <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/changes/${other.id}`} variant="secondary">
                            Open →
                          </LinkButton>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {summaryState.summary.captureDraftOverlaps.length > 0 && (
                  <CollapsibleSection title="Unreviewed import drafts touching these elements" meta={`(${String(summaryState.summary.captureDraftOverlaps.length)})`} defaultOpen={false}>
                    <ul className={styles.branchList}>
                      {summaryState.summary.captureDraftOverlaps.map(({ title, draftCount, latestJobId, sharedElementNames }) => (
                        <li key={title} className={styles.branchRow}>
                          <div className={styles.branchText}>
                            <Text as="span">{title}</Text>
                            <Text as="p" tone="muted" size="sm">
                              {draftCount > 1 ? `${String(draftCount)} drafts · ` : ''}Both touch {sharedElementNames.join(', ')}
                            </Text>
                          </div>
                          {latestJobId !== null && (
                            <div className={styles.branchActions}>
                              <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/review/capture/${latestJobId}`} variant="secondary">
                                Review →
                              </LinkButton>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </CollapsibleSection>
                )}
              </Panel>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** One affected capability per row, with why it counts (`describeImpactReasons`) — shared by the shown list and the collapsed remainder. */
function AffectedCapabilityList({ capabilities, orgSlug, modelSlug }: { capabilities: readonly AffectedCapability[]; orgSlug: string; modelSlug: string }) {
  return (
    <ul className={styles.capabilityList}>
      {capabilities.map(({ capability, reasons }) => (
        <li key={capability.element_id}>
          <div className={styles.subjectTitle}>
            <ElementTypeGlyph type="capability" />
            <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${capability.element_id}`}>
              <Text as="span">{capability.name}</Text>
            </Link>
          </div>
          <Text as="p" tone="muted" size="sm">
            {describeImpactReasons(reasons)}
          </Text>
        </li>
      ))}
    </ul>
  );
}

function AffectedValueStreamList({ valueStreams, orgSlug, modelSlug }: { valueStreams: readonly ChangeAffectedValueStream[]; orgSlug: string; modelSlug: string }) {
  return (
    <ul className={styles.capabilityList}>
      {valueStreams.map(({ stream, stages, reasons }) => (
        <li key={stream.element_id}>
          <div className={styles.subjectTitle}>
            <ElementTypeGlyph type="value_stream" />
            <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${stream.element_id}`}>
              <Text as="span">{stream.name}</Text>
            </Link>
          </div>
          {reasons.length > 0 && (
            <Text as="p" tone="muted" size="sm">
              {describeValueStreamReasons(reasons)}
            </Text>
          )}
          <ul className={styles.capabilityList}>
            {stages.map(({ stage, viaCapabilities, reasons: stageReasons }) => (
              <li key={stage.element_id}>
                <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${stage.element_id}`}>
                  <Text as="span" size="sm">
                    {stage.name}
                  </Text>
                </Link>
                {(viaCapabilities.length > 0 || stageReasons.length > 0) && (
                  <Text as="p" tone="muted" size="sm">
                    {[viaCapabilities.length > 0 ? `via ${viaCapabilities.map((c) => c.name).join(', ')}` : null, stageReasons.length > 0 ? describeValueStreamReasons(stageReasons) : null].filter((part): part is string => part !== null).join('; ')}
                  </Text>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
