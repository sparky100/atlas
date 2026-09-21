import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { CommentsSection } from '../components/CommentsSection/CommentsSection';
import { ConfidenceDots } from '../components/ConfidenceDots/ConfidenceDots';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { LinkButton } from '../components/Button/LinkButton';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { createChangeBranch, getMainBranch } from '../../db/branches';
import type { MemberRole, SourceRow } from '../../db/types';
import { useSelectedRef } from '../branches/useSelectedRef';
import { formatDateTime } from '../time';
import { canApproveOrMergeRequest, canCancelChange } from '../orgs/useMembership';
import { BranchRebasePanel } from '../reviews/BranchRebasePanel';
import { supabase } from '../supabaseClient';
import { dateFieldLabelForIntent, intentReviewWeight, isDateRequiredForIntent } from './branchIntent';
import { branchStatusTone } from './branchStatus';
import { deriveChangeStep } from './changeStepper';
import { describeDelta } from './changeSummaryFormat';
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
export function ChangeView({ orgId, modelId, branchId, orgSlug, modelSlug, role, canEdit }: ChangeViewProps) {
  const { userId } = useAuth();
  const { status, branch, error, updateMetadata, reload } = useChange(branchId);
  const summaryState = useChangeSummary(modelId, branch);
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

  if (status === 'loading') return <Text tone="muted">Loading…</Text>;
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
        setDuplicateError('This model has no main to fork from.');
        return;
      }
      const newBranch = await createChangeBranch(supabase, {
        id: crypto.randomUUID(),
        orgId,
        modelId,
        name: `${branch.name}-copy-${crypto.randomUUID().slice(0, 8)}`,
        ...(branch.title ? { title: branch.title } : {}),
        ...(branch.description ? { description: branch.description } : {}),
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
    setTitle(branch.title ?? '');
    setDescription(branch.description ?? '');
    setTargetDate(branch.target_date ?? '');
    setEditing(true);
  };

  return (
    <div>
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

      {/* S1 item 4: "listed ... with a reason" — the cancelled branch's own
          page is where that reason actually lives; the collapsed list on
          ChangesPage only names the change, not why. */}
      {branch.status === 'cancelled' && (
        <Panel>
          <Text as="p" size="sm">
            Cancelled{branch.cancelled_at ? ` ${formatDateTime(branch.cancelled_at)}` : ''}.
          </Text>
          {branch.cancel_reason && (
            <Text as="p" tone="muted" size="sm">
              {branch.cancel_reason}
            </Text>
          )}
          <Button variant="secondary" disabled={duplicating} onClick={() => void duplicateIntoNewDraft()}>
            {duplicating ? 'Duplicating…' : 'Duplicate into a new draft'}
          </Button>
          {duplicateError !== null && <Text as="p">{duplicateError}</Text>}
        </Panel>
      )}

      {/* Item 1: the stepper needs to know whether an open merge request
          exists (for the Draft/"sent back" sentence and the In
          review/Approved current-step distinction) — `openRequest` is
          already fetched for the Review panel below; `undefined` means
          still loading, so the stepper waits rather than rendering with a
          momentarily-wrong "no request" assumption. */}
      {openRequest !== undefined && <Stepper derived={deriveChangeStep(branch, openRequest)} />}

      {error !== null && <Text as="p">{error}</Text>}

      {branch.status === 'draft' && openRequest === null && (
        <Panel>
          <Text as="h2" size="lg">
            Rebase
          </Text>
          <BranchRebasePanel modelId={modelId} branch={branch} userId={userId} canEdit={canEdit} onRebased={reload} />
        </Panel>
      )}

      {(branch.status === 'draft' || openRequest !== null) && (
        <Panel>
          <Text as="h2" size="lg">
            Review
          </Text>
          {openRequest === undefined && (
            <Text tone="muted" size="sm">
              Checking for an open review request…
            </Text>
          )}
          {openRequest === null && branch.status === 'draft' && (
            <>
              <Text as="p" tone="muted" size="sm">
                Submitting opens the review queue for this change — a reviewer sees every edit, conflict, and affected capability before it can merge into main.
              </Text>
              {canEdit && (
                <Button
                  variant="primary"
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
            </>
          )}
          {openRequest && (
            <div className={styles.subjectTitle}>
              <Chip tone={branchStatusTone(branch.status)}>{branch.status}</Chip>
              <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/review/${openRequest.id}`} variant="secondary">
                Open review →
              </LinkButton>
            </div>
          )}
          {/* F0's resolved review-weight decision: record/correct get this
              one-click shortcut alongside "Open review →" above — the same
              atlas.approve_merge_request/atlas.merge_branch RPCs a reviewer
              would otherwise click through on the review request's own
              page, called in sequence from here instead. propose/explore
              keep that page as their only path (ReviewQueueView.tsx's own
              intent filter is what actually keeps them off the shared
              queue list; this button simply never renders for them). */}
          {openRequest && intentReviewWeight(intent) === 'single' && canApproveOrMergeRequest(role) && (openRequest.status === 'pending' || openRequest.status === 'approved') && (
            <>
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
              {approveAndMergeState.error !== null && <Text as="p">{approveAndMergeState.error}</Text>}
            </>
          )}
        </Panel>
      )}

      {/* S1 item 4: "Cancel a change: proposer or owner/architect, Draft or
          Proposed." Closing this also closes any open merge request
          (atlas.cancel_change's own comment) — the queue and My changes
          both drop it without either of them needing a change of their
          own (a closed request is no longer "open"; a cancelled branch was
          never in `MY_OPEN_STATUSES` to begin with). */}
      {canCancelChange(role, branch, userId) && (
        <Panel>
          <Text as="h2" size="lg">
            Cancel this change
          </Text>
          {!cancelling ? (
            <Button
              variant="destructive"
              onClick={() => {
                setCancelReason('');
                setCancelling(true);
              }}
            >
              Cancel this change…
            </Button>
          ) : (
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
                      // Same "only clear it if it was actually this branch"
                      // care every other exit path here already takes.
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
        </Panel>
      )}

      {!editing ? (
        <Panel>
          <div className={styles.field}>
            <Text as="h2" size="lg">
              Description
            </Text>
            <Text as="p" tone={branch.description ? 'default' : 'muted'}>
              {branch.description ?? 'No description.'}
            </Text>
          </div>
          {canEdit && (
            <Button variant="secondary" onClick={startEditing}>
              Edit
            </Button>
          )}
        </Panel>
      ) : (
        <Panel>
          <form
            className={styles.editForm}
            onSubmit={(e) => {
              e.preventDefault();
              void updateMetadata({
                title: title.trim().length > 0 ? title.trim() : null,
                description: description.trim().length > 0 ? description.trim() : null,
                // F0: `correct`/`explore` have no date field at all (see
                // `dateFieldLabelForIntent`'s own doc comment) — omitted
                // from the patch entirely, not sent as `null`, so an
                // unrelated edit never silently clears a date a `record`/
                // `propose` change already had before an intent change
                // (intent editing isn't UI yet, but the column itself is).
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
            {/* F0: "delivered date" for record, "target date" for propose
                — the same `branches.target_date` column either way (a
                deliberate reuse, `branchIntent.ts`'s own doc comment);
                `correct`/`explore` need no date at all, so the field is
                omitted entirely rather than shown disabled. */}
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
          {importSummary.state.status === 'loading' && <Text tone="muted">Loading…</Text>}
          {importSummary.state.status === 'error' && <Text as="p">{importSummary.state.message}</Text>}
          {importSummary.state.status === 'ready' && (
            <>
              <Text as="p" size="sm" tone="muted">
                From {importSummary.state.fileName}
              </Text>
              <div className={styles.importCounts}>
                <Chip tone="info">{summaryState.status === 'ready' ? summaryState.summary.subjects.filter((s) => s.subjectType === 'element' && (s.elementType === 'system' || s.elementType === 'container') && s.deltas.some((d) => d.kind === 'element.create')).length : 0} new</Chip>
                <Chip tone="info">{summaryState.status === 'ready' ? summaryState.summary.subjects.filter((s) => s.subjectType === 'element' && (s.elementType === 'system' || s.elementType === 'container') && !s.deltas.some((d) => d.kind === 'element.create')).length : 0} changed</Chip>
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

      <Panel>
        <Text as="h2" size="lg">
          Edits on this change
        </Text>
        {summaryState.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {summaryState.status === 'error' && <Text as="p">{summaryState.message}</Text>}
        {summaryState.status === 'ready' && summaryState.summary.subjects.length === 0 && <EmptyState>No edits yet — this change hasn't diverged from main.</EmptyState>}
        {summaryState.status === 'ready' && summaryState.summary.subjects.length > 0 && (
          <ul className={styles.subjectList}>
            {summaryState.summary.subjects.map((subject) => (
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
                        <ConfidenceDots confidence={delta.confidence} />
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <Text as="h2" size="lg">
          Comments on this change
        </Text>
        <CommentsSection orgId={orgId} modelId={modelId} userId={userId} role={role} anchorType="change" anchorId={branchId} branchId={branchId} />
      </Panel>

      <Panel>
        <Text as="h2" size="lg">
          Affected capabilities
        </Text>
        {summaryState.status === 'ready' && summaryState.summary.affectedCapabilities.length === 0 && <EmptyState>No capabilities are affected by this change yet.</EmptyState>}
        {summaryState.status === 'ready' && summaryState.summary.affectedCapabilities.length > 0 && (
          <ul className={styles.capabilityList}>
            {summaryState.summary.affectedCapabilities.map(({ capability, viaSystems }) => (
              <li key={capability.element_id}>
                <div className={styles.subjectTitle}>
                  <ElementTypeGlyph type="capability" />
                  <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${capability.element_id}`}>
                    <Text as="span">{capability.name}</Text>
                  </Link>
                </div>
                {viaSystems.length > 0 && (
                  <Text as="p" tone="muted" size="sm">
                    via {viaSystems.map((s) => s.name).join(', ')}
                  </Text>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <Text as="h2" size="lg">
          Affected value streams
        </Text>
        {summaryState.status === 'ready' && summaryState.summary.affectedValueStreams.length === 0 && <EmptyState>No value stream is affected by this change yet.</EmptyState>}
        {summaryState.status === 'ready' && summaryState.summary.affectedValueStreams.length > 0 && (
          <ul className={styles.capabilityList}>
            {summaryState.summary.affectedValueStreams.map(({ stream, stages }) => (
              <li key={stream.element_id}>
                <div className={styles.subjectTitle}>
                  <ElementTypeGlyph type="value_stream" />
                  <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${stream.element_id}`}>
                    <Text as="span">{stream.name}</Text>
                  </Link>
                </div>
                <ul className={styles.capabilityList}>
                  {stages.map(({ stage, viaCapabilities }) => (
                    <li key={stage.element_id}>
                      <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${stage.element_id}`}>
                        <Text as="span" size="sm">
                          {stage.name}
                        </Text>
                      </Link>
                      {viaCapabilities.length > 0 && (
                        <Text as="p" tone="muted" size="sm">
                          via {viaCapabilities.map((c) => c.name).join(', ')}
                        </Text>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <Text as="h2" size="lg">
          Other open changes touching the same elements
        </Text>
        {summaryState.status === 'ready' && summaryState.summary.otherOpenChanges.length === 0 && <EmptyState>No other open change touches the same elements.</EmptyState>}
        {summaryState.status === 'ready' && summaryState.summary.otherOpenChanges.length > 0 && (
          <ul className={styles.branchList}>
            {summaryState.summary.otherOpenChanges.map((other) => (
              <li key={other.id} className={styles.branchRow}>
                <Text as="span">{other.title ?? other.name}</Text>
                <div className={styles.subjectTitle}>
                  <Chip tone={branchStatusTone(other.status)}>{other.status}</Chip>
                  <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/changes/${other.id}`} variant="secondary">
                    Open →
                  </LinkButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <Text as="h2" size="lg">
          Delivered / remaining
        </Text>
        {summaryState.status === 'ready' && summaryState.lineage.splits.length === 0 && (
          <Text as="p" tone="muted">
            {branch.split_from ? 'This change was split from another one.' : 'Not split yet — everything is still on this change.'}
          </Text>
        )}
        {summaryState.status === 'ready' && summaryState.lineage.splits.length > 0 && (
          <ul className={styles.branchList}>
            {summaryState.lineage.splits.map((split) => (
              <li key={split.id} className={styles.branchRow}>
                <Text as="span">{split.title ?? split.name}</Text>
                <div className={styles.subjectTitle}>
                  <Chip tone={branchStatusTone(split.status)}>{split.status === 'merged' ? 'delivered' : split.status}</Chip>
                  <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/changes/${split.id}`} variant="secondary">
                    Open →
                  </LinkButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
