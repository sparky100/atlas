import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import type { BranchRow } from '../../db/types';
import { groupStructuralFindings } from '../../engine/structuralFindingGroups';
import { FieldConflictCard, IdentityWarningCard, PairConflictCard, RetractionConflictCard } from './ConflictCards';
import { useBranchRebase } from './useBranchRebase';
import styles from './BranchRebasePanel.module.css';

export interface BranchRebasePanelProps {
  modelId: UUID;
  branch: BranchRow;
  userId: UUID | null;
  /** Contributor+ on this change (the same gate `ChangeView`'s "Submit for review" uses) — a viewer sees the up-to-date/behind state but no rebase action. */
  canEdit: boolean;
  /** Called after a successful rebase — the branch's own `head_commit_id` moved, so the caller's `useChange` needs to reload it. */
  onRebased: () => void;
}

/**
 * A draft change's own "bring up to date" (internally a rebase on main) (Sprint C1 step 8, the user's
 * brief: "Rebase branch on new main head with conflict surfacing") —
 * lets the author pull in main *before* ever submitting for review, so a
 * long-lived draft doesn't first discover it's behind at review time.
 * Reuses the exact same conflict cards the review request's own page uses
 * (src/ui/reviews/ConflictCards.tsx) — the same findings, the same
 * three-way context, whether or not a merge request exists yet.
 *
 * Deliberately not shown once a merge request is open (see `ChangeView`'s
 * own call site): from that point on, refreshing goes through the review
 * request's page instead, since it also has to resubmit the request's
 * cached classification — this panel has no merge request to update.
 */
export function BranchRebasePanel({ modelId, branch, userId, canEdit, onRebased }: BranchRebasePanelProps) {
  const rebase = useBranchRebase(modelId, branch, userId, onRebased);

  // Nothing to show until there is something to decide: a "checking…" flash or a
  // "nothing to do" reassurance would only add noise to the change page.
  if (rebase.state.status === 'loading') return null;
  if (rebase.state.status === 'error') return rebase.state.quiet ? null : <Text as="p">{rebase.state.message}</Text>;

  const { review } = rebase.state;
  const { classification, threeWay } = review;
  const blockingFindings = classification.findings.filter((f) => f.blocking);
  const identityFindings = classification.findings.filter((f) => !f.blocking);
  const fieldConflictFindings = blockingFindings.filter((f) => f.class === 'field-conflict');
  const { retractions, duplicates, cardinalities } = groupStructuralFindings(review);
  const structuralCardCount = retractions.length + duplicates.length + cardinalities.length;

  if (threeWay.upToDateWithMain && classification.findings.length === 0) return null;

  return (
    <Panel>
      <Text as="h2" size="lg">
        {threeWay.upToDateWithMain ? 'Some of your edits need a decision' : 'The model has changed since you started'}
      </Text>
      <Text as="p" tone="muted" size="sm">
        {threeWay.upToDateWithMain
          ? 'Sort these out before you send the change for review.'
          : 'Bring this change up to date so it is checked against the latest version. If something you edited was also changed by someone else, you will be asked which to keep.'}
      </Text>
      {(blockingFindings.length > 0 || identityFindings.length > 0) && (
        <div className={styles.summary}>
          {blockingFindings.length > 0 && (
            <Text as="span" tone="muted" size="sm">
              {blockingFindings.length} {blockingFindings.length === 1 ? 'clash' : 'clashes'} to sort out
            </Text>
          )}
          {identityFindings.length > 0 && (
            <Text as="span" tone="faint" size="xs">
              {identityFindings.length} possible {identityFindings.length === 1 ? 'duplicate' : 'duplicates'}
            </Text>
          )}
        </div>
      )}

      {rebase.actionError !== null && <Text as="p">{rebase.actionError}</Text>}

      {canEdit && (
        <div className={styles.actionsRow}>
          <Button
            variant="secondary"
            disabled={rebase.actionStatus === 'working'}
            onClick={() => {
              void rebase.pushRebase();
            }}
          >
            {rebase.stagedChoiceCount > 0 ? `Bring up to date (${String(rebase.stagedChoiceCount)} decided)` : 'Bring up to date'}
          </Button>
        </div>
      )}

      {structuralCardCount > 0 && (
        <div className={styles.section}>
          <Text as="h3" size="md">
            Links and retirements that clash
          </Text>
          <ul className={styles.cardList}>
            {retractions.map((data) => (
              <RetractionConflictCard key={data.elementId} data={data} canResolve={canEdit} choice={rebase.retractionChoiceFor(data.elementId)} onChoose={rebase.setStructuralChoice} />
            ))}
            {duplicates.map((data) => (
              <PairConflictCard
                key={`${data.relationshipId} ${data.relatedRelationshipId}`}
                data={data}
                canResolve={canEdit}
                choice={rebase.pairChoiceFor(data.relationshipId, data.relatedRelationshipId, data.findingClass)}
                onChoose={rebase.setStructuralChoice}
              />
            ))}
            {cardinalities.map((data) => (
              <PairConflictCard
                key={`${data.relationshipId} ${data.relatedRelationshipId}`}
                data={data}
                canResolve={canEdit}
                choice={rebase.pairChoiceFor(data.relationshipId, data.relatedRelationshipId, data.findingClass)}
                onChoose={rebase.setStructuralChoice}
              />
            ))}
          </ul>
        </div>
      )}

      {fieldConflictFindings.length > 0 && (
        <div className={styles.section}>
          <Text as="h3" size="md">
            Values you and someone else both changed
          </Text>
          <ul className={styles.cardList}>
            {fieldConflictFindings.map((finding) => (
              <FieldConflictCard
                key={`${finding.subjectId} ${finding.attribute ?? ''}`}
                finding={finding}
                threeWay={threeWay}
                canResolve={canEdit}
                choice={rebase.fieldChoiceFor(finding.subjectId, finding.attribute ?? '')}
                onChoose={rebase.setFieldChoice}
                onClear={rebase.clearFieldChoice}
              />
            ))}
          </ul>
        </div>
      )}

      {identityFindings.length > 0 && (
        <div className={styles.section}>
          <Text as="h3" size="md">
            Possible duplicates
          </Text>
          <ul className={styles.cardList}>
            {identityFindings.map((finding, i) => (
              <IdentityWarningCard
                key={`${finding.subjectId}-${finding.relatedSubjectId ?? ''}-${String(i)}`}
                finding={finding}
                heads={[threeWay.ours, threeWay.theirs, threeWay.base]}
                dismissed={finding.relatedSubjectId ? rebase.isIdentityPairDismissed(finding.subjectId, finding.relatedSubjectId) : false}
                onDismiss={() => {
                  const relatedId = finding.relatedSubjectId;
                  if (relatedId) rebase.dismissIdentityPair(finding.subjectId, relatedId);
                }}
              />
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
