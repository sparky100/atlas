import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { Text } from '../components/Text/Text';
import type { BranchRow } from '../../db/types';
import { FieldConflictCard, IdentityWarningCard, StructuralConflictCard } from './ConflictCards';
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
 * A draft change's own "rebase on main" (Sprint C1 step 8, the user's
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

  if (rebase.state.status === 'loading') return <Text tone="muted">Checking against main…</Text>;
  if (rebase.state.status === 'error') return <Text as="p">{rebase.state.message}</Text>;

  const { review } = rebase.state;
  const { classification, threeWay } = review;
  const blockingFindings = classification.findings.filter((f) => f.blocking);
  const identityFindings = classification.findings.filter((f) => !f.blocking);
  const structuralFindings = blockingFindings.filter((f) => f.class !== 'field-conflict');
  const fieldConflictFindings = blockingFindings.filter((f) => f.class === 'field-conflict');

  if (threeWay.upToDateWithMain && classification.findings.length === 0) {
    return (
      <Text as="p" tone="muted" size="sm">
        Up to date with main.
      </Text>
    );
  }

  return (
    <div>
      <div className={styles.summary}>
        <Chip tone={threeWay.upToDateWithMain ? 'ok' : 'warn'}>{threeWay.upToDateWithMain ? 'up to date' : 'behind main'}</Chip>
        {blockingFindings.length > 0 && (
          <Text as="span" tone="muted" size="sm">
            {blockingFindings.length} blocking conflict{blockingFindings.length === 1 ? '' : 's'}
          </Text>
        )}
        {identityFindings.length > 0 && (
          <Text as="span" tone="faint" size="xs">
            {identityFindings.length} identity warning{identityFindings.length === 1 ? '' : 's'}
          </Text>
        )}
      </div>

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
            {rebase.stagedChoiceCount > 0 ? `Rebase on main (${String(rebase.stagedChoiceCount)} resolved)` : 'Rebase on main'}
          </Button>
        </div>
      )}

      {structuralFindings.length > 0 && (
        <div className={styles.section}>
          <Text as="h3" size="md">
            Structural conflicts
          </Text>
          <Text as="p" tone="muted" size="sm">
            Fix these with the ordinary change editor (un-retract, remove the dangling relationship, drop the duplicate), then rebase.
          </Text>
          <ul className={styles.cardList}>
            {structuralFindings.map((finding, i) => (
              <StructuralConflictCard key={`${finding.class}-${finding.subjectId}-${String(i)}`} finding={finding} heads={[threeWay.ours, threeWay.theirs, threeWay.base]} />
            ))}
          </ul>
        </div>
      )}

      {fieldConflictFindings.length > 0 && (
        <div className={styles.section}>
          <Text as="h3" size="md">
            Field conflicts
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
            Identity warnings
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
    </div>
  );
}
