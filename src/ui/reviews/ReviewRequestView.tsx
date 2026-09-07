import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { canApproveOrMergeRequest, canReviewMergeRequest, useMembership } from '../orgs/useMembership';
import { useAuth } from '../auth/useAuth';
import { branchStatusTone } from '../changes/branchStatus';
import { CleanChanges, FieldConflictCard, IdentityWarningCard, StructuralConflictCard } from './ConflictCards';
import { mergeRequestStatusTone } from './mergeRequestStatus';
import { useReviewRequest } from './useReviewRequest';
import styles from './ReviewRequestView.module.css';

export interface ReviewRequestViewProps {
  modelId: UUID;
  mergeRequestId: UUID;
  orgId: UUID;
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
 * keep main / enter a value, per §7.4). Structural conflicts and identity
 * warnings are rendered with full three-way context but their bespoke
 * resolution actions (retract-cascade, duplicate-relationship survivor
 * pick, cardinality pick, `atlas.merge_elements`) are not built this step —
 * see src/db/mergeRequests.ts's own module comment for why, and each
 * structural card names the real path that exists today: reopen the
 * branch and fix it with the ordinary editor, then refresh.
 */
export function ReviewRequestView({ modelId, mergeRequestId, orgId }: ReviewRequestViewProps) {
  const { userId } = useAuth();
  const { role } = useMembership(orgId, userId);
  const canReview = canReviewMergeRequest(role);
  const canApproveOrMerge = canApproveOrMergeRequest(role);
  const rr = useReviewRequest(modelId, mergeRequestId, userId);

  if (rr.state.status === 'loading') return <Text tone="muted">Loading…</Text>;
  if (rr.state.status === 'error') return <Text as="p">{rr.state.message}</Text>;

  const { request, branch, review } = rr.state;
  const { classification, threeWay } = review;
  const blockingFindings = classification.findings.filter((f) => f.blocking);
  const identityFindings = classification.findings.filter((f) => !f.blocking);
  const structuralFindings = blockingFindings.filter((f) => f.class !== 'field-conflict');
  const fieldConflictFindings = blockingFindings.filter((f) => f.class === 'field-conflict');

  const canApproveNow = !classification.hasBlockingConflict && threeWay.upToDateWithMain && canApproveOrMerge && request.status === 'pending';

  return (
    <div>
      <Panel>
        <div className={styles.summary}>
          <Chip tone={mergeRequestStatusTone(request.status)}>{request.status.replace('_', ' ')}</Chip>
          <Chip tone={branchStatusTone(branch.status)}>{branch.status}</Chip>
          <Text as="span" tone="muted" size="sm">
            Requested by {request.requested_by}
          </Text>
          <Text as="span" tone="faint" size="xs">
            {blockingFindings.length} blocking · {identityFindings.length} advisory
          </Text>
        </div>

        {!threeWay.upToDateWithMain && (
          <div className={styles.banner}>
            <Text as="p" size="sm">
              Main has moved since this branch forked — a refresh is required before this can be approved.
            </Text>
          </div>
        )}

        {rr.actionError !== null && <Text as="p">{rr.actionError}</Text>}

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
              {rr.stagedChoiceCount > 0 ? `Push refresh (${String(rr.stagedChoiceCount)} resolved) & resubmit` : 'Pull in main & resubmit'}
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
          {canApproveOrMerge && (
            <Button
              variant="primary"
              disabled={!canApproveNow || rr.actionStatus === 'working'}
              title={!canApproveNow ? 'Needs no blocking conflicts, an up-to-date branch, and a pending request' : undefined}
              onClick={() => {
                void rr.approve();
              }}
            >
              Approve
            </Button>
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

      {structuralFindings.length > 0 && (
        <Panel>
          <Text as="h2" size="lg">
            Structural conflicts
          </Text>
          <Text as="p" tone="muted" size="sm">
            No one-click resolution yet for these — reopen this branch for edits, fix them with the ordinary branch editor (un-retract, remove the dangling relationship, drop the duplicate), then push a refresh.
          </Text>
          <ul className={styles.cardList}>
            {structuralFindings.map((finding, i) => (
              <StructuralConflictCard key={`${finding.class}-${finding.subjectId}-${String(i)}`} finding={finding} heads={[threeWay.ours, threeWay.theirs, threeWay.base]} />
            ))}
          </ul>
        </Panel>
      )}

      {fieldConflictFindings.length > 0 && (
        <Panel>
          <Text as="h2" size="lg">
            Field conflicts
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
              />
            ))}
          </ul>
        </Panel>
      )}

      {identityFindings.length > 0 && (
        <Panel>
          <Text as="h2" size="lg">
            Identity warnings
          </Text>
          <Text as="p" tone="muted" size="sm">
            Advisory only — never blocks approval. "Merge now" isn't built yet (element merge is a later sprint); "Keep both" just dismisses the warning for this browser session.
          </Text>
          <ul className={styles.cardList}>
            {identityFindings.map((finding, i) => (
              <IdentityWarningCard
                key={`${finding.subjectId}-${finding.relatedSubjectId ?? ''}-${String(i)}`}
                finding={finding}
                heads={[threeWay.ours, threeWay.theirs, threeWay.base]}
                dismissed={finding.relatedSubjectId ? rr.isIdentityPairDismissed(finding.subjectId, finding.relatedSubjectId) : false}
                onDismiss={() => {
                  if (finding.relatedSubjectId) rr.dismissIdentityPair(finding.subjectId, finding.relatedSubjectId);
                }}
              />
            ))}
          </ul>
        </Panel>
      )}

      <Panel>
        <details>
          <summary>
            <Text as="span" size="lg">
              Clean changes ({classification.clean.length})
            </Text>
          </summary>
          <CleanChanges base={threeWay.base} ours={threeWay.ours} cleanIds={classification.clean} />
        </details>
      </Panel>
    </div>
  );
}
