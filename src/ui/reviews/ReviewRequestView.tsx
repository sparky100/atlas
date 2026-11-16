import { Loading } from '../components/Loading/Loading';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { refQueryParam } from '../../db/ref';
import type { ReviewVerdict } from '../../db/types';
import { Button } from '../components/Button/Button';
import { CardComments } from '../components/CardComments/CardComments';
import { Chip, type ChipTone } from '../components/Chip/Chip';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { profileLabel } from '../comments/profileLabel';
import { useThreadCounts } from '../comments/useThreadCounts';
import { canApproveOrMergeRequest, canReviewMergeRequest, useMembership } from '../orgs/useMembership';
import { useAuth } from '../auth/useAuth';
import { branchStatusTone } from '../changes/branchStatus';
import { groupStructuralFindings } from '../../engine/structuralFindingGroups';
import { CleanChanges, FieldConflictCard, IdentityWarningCard, PairConflictCard, RetractionConflictCard } from './ConflictCards';
import { subjectAnchorType } from './elementBreadcrumb';
import { mergeRequestStatusTone } from './mergeRequestStatus';
import { SplitReviewPanel } from './SplitReviewPanel';
import { useReviewRequest } from './useReviewRequest';
import { OverdueReviewFlag } from './OverdueReviewFlag';
import { useReviewPeriodDays } from './useReviewPeriodDays';
import styles from './ReviewRequestView.module.css';

const VERDICT_TONE: Record<ReviewVerdict, ChipTone> = { approve: 'ok', request_changes: 'danger', abstain: 'neutral', pending: 'neutral' };

export interface ReviewRequestViewProps {
  modelId: UUID;
  mergeRequestId: UUID;
  orgId: UUID;
  /** S1 item 2: "View this change" — both only needed to build that one link (Landscape at this request's branch ref, read-only). `ReviewRequestPage.tsx` already has both in scope for its own routing. */
  orgSlug: string;
  modelSlug: string;
}

/**
 * A review request's own page (Sprint C1 step 7, SPEC §7.4). Sections, in
 * the order UI-principles §5.3's review-queue centre pane specifies:
 * summary row, structural conflicts, field conflicts, identity warnings,
 * clean changes collapsed. The cards themselves live in
 * src/ui/reviews/ConflictCards.tsx, shared with the change page's own
 * "rebase on main" panel (Sprint C1 step 8) — same findings, same
 * three-way context, before or after a merge request exists.
 *
 * Scope: field-conflict cards resolve with one click (keep this change /
 * keep main / enter a value, per §7.4). Structural conflicts now resolve
 * with real actions too (ADR-021, C2b): keep-retraction/keep-element with
 * the cascade named in consequences, duplicate-relationship survivor pick,
 * cardinality primary/role pick — `src/engine/structuralFindingGroups.ts`
 * groups the findings, `useReviewRequest.ts` stages the choices,
 * `src/db/mergeRequests.ts`'s `pushRefresh` builds and commits the
 * resolution via `atlas.refresh_branch`. Identity warnings' own
 * `atlas.merge_elements` remains unbuilt (SPEC §11) — "keep both" (dismiss)
 * is the only action there.
 */
export function ReviewRequestView({ modelId, mergeRequestId, orgId, orgSlug, modelSlug }: ReviewRequestViewProps) {
  const { userId } = useAuth();
  const { role } = useMembership(orgId, userId);
  const canReview = canReviewMergeRequest(role);
  const canApproveOrMerge = canApproveOrMergeRequest(role);
  const rr = useReviewRequest(modelId, mergeRequestId, userId);
  const periodDays = useReviewPeriodDays(orgId);

  // Per-subject comment threads (Sprint M1b, `docs/HANDOFF-M1b-comments.md`'s
  // 6b: "each Field-conflict card, each Identity-warning card, and each row
  // of the collapsed Clean changes list") — one batched count for every
  // subject this page can show a card for, so each card's own toggle opens
  // straight to a known count rather than a per-card fetch. Computed before
  // the loading/error early returns below (rules-of-hooks: every hook call
  // here must run on every render, `rr.state` ready or not), falling back
  // to an empty id list until `rr.state` actually has findings to name.
  const readyReview = rr.state.status === 'ready' ? rr.state.review : null;
  const cardSubjectIds = readyReview
    ? [...new Set(readyReview.classification.findings.map((f) => f.subjectId).concat(readyReview.classification.clean))]
    : [];
  const threadCountsState = useThreadCounts(modelId, cardSubjectIds);

  if (rr.state.status === 'loading') return <Loading />;
  if (rr.state.status === 'error') return <Text as="p">{rr.state.message}</Text>;

  const { request, branch, review, mainHeadCommitId, requesterProfile, verdicts, reviewerProfiles } = rr.state;
  const { classification, threeWay } = review;
  const blockingFindings = classification.findings.filter((f) => f.blocking);
  const identityFindings = classification.findings.filter((f) => !f.blocking);
  const fieldConflictFindings = blockingFindings.filter((f) => f.class === 'field-conflict');
  const { retractions, duplicates, cardinalities } = groupStructuralFindings(review);
  const structuralCardCount = retractions.length + duplicates.length + cardinalities.length;
  // F3a: propose/explore carry a reviewer set; record/correct stay on the
  // single-approver path (the change page's own "Approve & merge").
  const isMultiReviewer = branch.intent === 'propose' || branch.intent === 'explore';
  const requiredVerdicts = verdicts.filter((v) => v.required);
  const approvedRequiredCount = requiredVerdicts.filter((v) => v.verdict === 'approve').length;
  const myVerdict = userId ? verdicts.find((v) => v.user_id === userId) : undefined;
  // S1 item 3: "counts of things, not facts" — `classification.findings` is
  // flat and per-attribute (two conflicting attributes on one element are
  // two entries), so counting it directly counts conflicting *facts*, not
  // conflicting *subjects*. Distinct `subjectId`s is the "thing" a reviewer
  // actually cares about the count of.
  const blockingSubjectCount = new Set(blockingFindings.map((f) => f.subjectId)).size;
  const advisorySubjectCount = new Set(identityFindings.map((f) => f.subjectId)).size;

  const canApproveNow = !classification.hasBlockingConflict && threeWay.upToDateWithMain && canApproveOrMerge && request.status === 'pending';

  const heads = [threeWay.ours, threeWay.theirs, threeWay.base];
  const threadCounts = threadCountsState.status === 'ready' ? threadCountsState.counts : undefined;
  const totalUnresolved = threadCounts ? [...threadCounts.values()].reduce((sum, c) => sum + c.open, 0) : 0;

  function renderCardComments(subjectId: UUID) {
    return (
      <CardComments
        orgId={orgId}
        modelId={modelId}
        userId={userId}
        role={role}
        anchorType={subjectAnchorType(heads, subjectId)}
        anchorId={subjectId}
        branchId={branch.id}
        unresolvedCount={threadCounts?.get(subjectId)?.open}
      />
    );
  }

  return (
    <div>
      <Panel>
        <div className={styles.summary}>
          <Chip tone={mergeRequestStatusTone(request.status)}>{request.status.replace('_', ' ')}</Chip>
          <Chip tone={branchStatusTone(branch.status)}>{branch.status}</Chip>
          <OverdueReviewFlag request={request} periodDays={periodDays} canRemind={role === 'owner' || role === 'architect' || request.requested_by === userId} />
          <Text as="span" tone="muted" size="sm">
            Requested by {profileLabel(requesterProfile)}
          </Text>
          {blockingSubjectCount > 0 && (
            <Text as="span" tone="faint" size="xs">
              {blockingSubjectCount} {blockingSubjectCount === 1 ? 'clash' : 'clashes'} to sort out
            </Text>
          )}
          {advisorySubjectCount > 0 && (
            <Text as="span" tone="faint" size="xs">
              {advisorySubjectCount} possible {advisorySubjectCount === 1 ? 'duplicate' : 'duplicates'}
            </Text>
          )}
          {/* S1 item 3: "comment count only when non-zero" — a "0 unresolved comments" line was never itself information a reviewer acts on. */}
          {totalUnresolved > 0 && (
            <Text as="span" tone="faint" size="xs">
              {totalUnresolved} unresolved comment{totalUnresolved === 1 ? '' : 's'}
            </Text>
          )}
          {/* S1 item 2: "review request ... pages get 'View this change'" — Landscape at this branch's ref, read-only. Available regardless of role/status: a reviewer looking at any request, at any point, can see the change's own To-be state. */}
          <Link to={`/o/${orgSlug}/m/${modelSlug}/landscape?${refQueryParam({ kind: 'branch', branchId: branch.id }, true)}`}>
            <Button variant="secondary">View this change</Button>
          </Link>
        </div>

        {!threeWay.upToDateWithMain && (
          <div className={styles.banner}>
            <Text as="p" size="sm">
              The live model has changed since this change started. Bring it up to date (button at the bottom) before it can be approved.
            </Text>
          </div>
        )}

        {rr.actionError !== null && <Text as="p">{rr.actionError}</Text>}
      </Panel>

      {isMultiReviewer && (
        <Panel>
          <Text as="h2" size="lg">
            Reviewers
          </Text>
          <Text as="p" tone="muted" size="sm">
            {approvedRequiredCount} of {requiredVerdicts.length} required approver{requiredVerdicts.length === 1 ? '' : 's'}
          </Text>
          <ul className={styles.cardList}>
            {verdicts.map((v) => {
              const profile = reviewerProfiles.get(v.user_id);
              return (
                <li key={v.user_id}>
                  <Text as="span">{profile ? profileLabel(profile) : v.user_id}</Text>
                  <Chip tone={VERDICT_TONE[v.verdict]}>{v.verdict.replace('_', ' ')}</Chip>
                  <Chip tone="neutral">{v.required ? 'required' : 'optional'}</Chip>
                  {v.comment && v.comment.trim().length > 0 && (
                    <Text as="span" tone="muted" size="sm">
                      {v.comment}
                    </Text>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {request.status === 'pending' && threeWay.upToDateWithMain && (
        <SplitReviewPanel modelId={modelId} branch={branch} mainHeadCommitId={mainHeadCommitId} review={review} canSplit={canApproveOrMerge} onSplit={rr.reload} />
      )}

      {structuralCardCount > 0 && (
        <Panel>
          <Text as="h2" size="lg">
            Links and retirements that clash
          </Text>
          <ul className={styles.cardList}>
            {retractions.map((data) => (
              <RetractionConflictCard
                key={data.elementId}
                data={data}
                canResolve={canReview}
                choice={rr.retractionChoiceFor(data.elementId)}
                onChoose={rr.setStructuralChoice}
                commentsSlot={renderCardComments(data.elementId)}
              />
            ))}
            {duplicates.map((data) => (
              <PairConflictCard
                key={`${data.relationshipId} ${data.relatedRelationshipId}`}
                data={data}
                canResolve={canReview}
                choice={rr.pairChoiceFor(data.relationshipId, data.relatedRelationshipId, data.findingClass)}
                onChoose={rr.setStructuralChoice}
                commentsSlot={renderCardComments(data.relationshipId)}
              />
            ))}
            {cardinalities.map((data) => (
              <PairConflictCard
                key={`${data.relationshipId} ${data.relatedRelationshipId}`}
                data={data}
                canResolve={canReview}
                choice={rr.pairChoiceFor(data.relationshipId, data.relatedRelationshipId, data.findingClass)}
                onChoose={rr.setStructuralChoice}
                commentsSlot={renderCardComments(data.relationshipId)}
              />
            ))}
          </ul>
        </Panel>
      )}

      {fieldConflictFindings.length > 0 && (
        <Panel>
          <Text as="h2" size="lg">
            Values you and someone else both changed
          </Text>
          <ul className={styles.cardList}>
            {fieldConflictFindings.map((finding) => (
              <FieldConflictCard
                key={`${finding.subjectId} ${finding.attribute ?? ''}`}
                finding={finding}
                threeWay={threeWay}
                canResolve={canReview}
                choice={rr.fieldChoiceFor(finding.subjectId, finding.attribute ?? '')}
                onChoose={rr.setFieldChoice}
                onClear={rr.clearFieldChoice}
                commentsSlot={renderCardComments(finding.subjectId)}
              />
            ))}
          </ul>
        </Panel>
      )}

      {identityFindings.length > 0 && (
        <Panel>
          <Text as="h2" size="lg">
            Possible duplicates
          </Text>
          <Text as="p" tone="muted" size="sm">
            These never block approval. "Keep both" hides the warning on this screen for this session.
          </Text>
          <ul className={styles.cardList}>
            {identityFindings.map((finding, i) => (
              <IdentityWarningCard
                key={`${finding.subjectId}-${finding.relatedSubjectId ?? ''}-${String(i)}`}
                finding={finding}
                heads={heads}
                dismissed={finding.relatedSubjectId ? rr.isIdentityPairDismissed(finding.subjectId, finding.relatedSubjectId) : false}
                onDismiss={() => {
                  if (finding.relatedSubjectId) rr.dismissIdentityPair(finding.subjectId, finding.relatedSubjectId);
                }}
                commentsSlot={renderCardComments(finding.subjectId)}
              />
            ))}
          </ul>
        </Panel>
      )}

      <Panel>
        <details>
          <summary>
            <Text as="span" size="lg">
              Clean changes — no conflicts or warnings ({classification.clean.length})
            </Text>
          </summary>
          <CleanChanges base={threeWay.base} ours={threeWay.ours} cleanIds={classification.clean} commentsSlotFor={renderCardComments} />
        </details>
      </Panel>

      {/* S1 item 3: "content before actions" — the actual decision buttons
          (Approve/Reject/Merge/Reopen/Refresh) render last, once every
          conflict, the split option, and the clean-changes list have all
          had their chance to inform the reviewer, not first, above them all,
          the way this Panel used to bundle them with the summary row. */}
      <Panel>
        <div className={styles.finalActions}>
          {canReview && request.status !== 'changes_requested' && (request.status === 'pending' || request.status === 'approved') && (
            <Button
              variant="ghost"
              disabled={rr.actionStatus === 'working'}
              onClick={() => {
                void rr.reopenForEdits();
              }}
            >
              Reopen for edits
            </Button>
          )}
          {canReview && branch.status === 'draft' && (
            <Button
              variant="secondary"
              disabled={rr.actionStatus === 'working'}
              onClick={() => {
                void rr.pushRefreshAndResubmit();
              }}
            >
              {rr.stagedChoiceCount > 0 ? `Bring up to date (${String(rr.stagedChoiceCount)} decided) and resubmit` : 'Bring up to date and resubmit'}
            </Button>
          )}
          {canApproveOrMerge && (request.status === 'pending' || request.status === 'changes_requested' || request.status === 'approved') && (
            <Button
              variant="ghost"
              disabled={rr.actionStatus === 'working'}
              onClick={() => {
                void rr.reject();
              }}
            >
              Reject
            </Button>
          )}
          {!isMultiReviewer && canApproveOrMerge && request.status === 'pending' && (
            <Button
              variant="primary"
              disabled={!canApproveNow || rr.actionStatus === 'working'}
              title={!canApproveNow ? 'Sort out the clashes and bring the change up to date first.' : undefined}
              onClick={() => {
                void rr.approve();
              }}
            >
              Approve
            </Button>
          )}
          {isMultiReviewer && myVerdict !== undefined && request.status === 'pending' && (
            <div className={styles.verdictControls}>
              <Text as="span" size="sm" tone="muted">
                Your review:
              </Text>
              {/* Same conditions as the single-approver path's Approve (`canApproveNow`, SPEC §7.4): a reviewer can't approve while a blocking conflict is open or the change is behind main — it couldn't merge yet anyway (merge_branch would send it back for a refresh). Request changes and Abstain stay available. */}
              <Button
                variant="primary"
                disabled={rr.actionStatus === 'working' || myVerdict.verdict === 'approve' || classification.hasBlockingConflict || !threeWay.upToDateWithMain}
                title={classification.hasBlockingConflict || !threeWay.upToDateWithMain ? 'Sort out the clashes and bring the change up to date first.' : undefined}
                onClick={() => void rr.castVerdict('approve')}
              >
                Approve
              </Button>
              <Button variant="secondary" disabled={rr.actionStatus === 'working'} onClick={() => void rr.castVerdict('request_changes')}>
                Request changes
              </Button>
              <Button variant="ghost" disabled={rr.actionStatus === 'working' || myVerdict.verdict === 'abstain'} onClick={() => void rr.castVerdict('abstain')}>
                Abstain
              </Button>
            </div>
          )}
          {canApproveOrMerge && request.status === 'approved' && (
            <Button
              variant="primary"
              disabled={rr.actionStatus === 'working'}
              onClick={() => {
                void rr.merge();
              }}
            >
              Merge
            </Button>
          )}
        </div>
      </Panel>
    </div>
  );
}
