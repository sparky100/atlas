import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { DiffBadge } from '../components/DiffBadge/DiffBadge';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import type { SourceRow } from '../../db/types';
import type { FactRow, Head } from '../../engine/deltas';
import type { ConflictFinding } from '../../engine/merge';
import type { FieldConflictChoice } from '../../engine/mergeResolution';
import { computeVersionDiff } from '../../engine/versionDiff';
import { canApproveOrMergeRequest, canReviewMergeRequest, useMembership } from '../orgs/useMembership';
import { useAuth } from '../auth/useAuth';
import { elementBreadcrumb, subjectName } from './elementBreadcrumb';
import { mergeRequestStatusTone } from './mergeRequestStatus';
import { branchStatusTone } from '../changes/branchStatus';
import { useReviewRequest, type ReviewRequestData } from './useReviewRequest';
import styles from './ReviewRequestView.module.css';

export interface ReviewRequestViewProps {
  modelId: UUID;
  mergeRequestId: UUID;
  orgId: UUID;
}

function formatFactValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * A review request's own page (Sprint C1 step 7, SPEC §7.4). Sections, in
 * the order UI-principles §5.3's review-queue centre pane specifies:
 * summary row, structural conflicts, field conflicts, identity warnings,
 * clean changes collapsed.
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
  const rr = useReviewRequest(modelId, mergeRequestId);

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
                data={rr.state as ReviewRequestData}
                sourcesById={rr.state.status === 'ready' ? rr.state.sourcesById : new Map()}
                canReview={canReview}
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

function StructuralConflictCard({ finding, heads }: { finding: ConflictFinding; heads: readonly Head[] }) {
  return (
    <li className={styles.card}>
      <div className={styles.cardTitle}>
        <Chip tone="danger">{finding.class.replace('structural:', '').replace(/-/g, ' ')}</Chip>
        <Text as="span" size="lg">
          {subjectName(heads, finding.subjectId)}
        </Text>
      </div>
      <Text as="p" size="sm">
        {finding.detail}
      </Text>
      {finding.relatedSubjectId && (
        <Text as="p" tone="muted" size="sm">
          Related: {subjectName(heads, finding.relatedSubjectId)}
        </Text>
      )}
    </li>
  );
}

interface FieldConflictCardProps {
  finding: ConflictFinding;
  data: ReviewRequestData;
  sourcesById: Map<UUID, SourceRow>;
  canReview: boolean;
  choice: FieldConflictChoice | undefined;
  onChoose: (choice: FieldConflictChoice) => void;
  onClear: (subjectId: UUID, attribute: string) => void;
}

function FactColumn({ label, fact }: { label: string; fact: FactRow | undefined }) {
  return (
    <div className={styles.column}>
      <Text as="span" size="sm" tone="muted">
        {label}
      </Text>
      <div className={styles.columnBody}>
        <Text as="span" size="md">
          {fact ? formatFactValue(fact.value) : '—'}
        </Text>
        {fact && (
          <Text as="span" tone="faint" size="xs">
            confidence {String(Math.round(fact.confidence * 100))}%
          </Text>
        )}
      </div>
    </div>
  );
}

function FieldConflictCard({ finding, data, canReview, choice, onChoose, onClear }: FieldConflictCardProps) {
  const [customValue, setCustomValue] = useState('');
  const { threeWay } = data.review;
  const attribute = finding.attribute ?? '';
  const field = threeWay.fields.find((f) => f.subjectId === finding.subjectId && f.attribute === attribute);
  const elementRow = threeWay.ours.elements.get(finding.subjectId) ?? threeWay.theirs.elements.get(finding.subjectId);

  return (
    <li className={styles.card}>
      <div className={styles.cardTitle}>
        {elementRow && <ElementTypeGlyph type={elementRow.elementType} />}
        <Text as="span" size="lg">
          {subjectName([threeWay.ours, threeWay.theirs, threeWay.base], finding.subjectId)}
        </Text>
        <Text as="span" tone="muted" size="sm">
          {attribute}
        </Text>
      </div>
      {elementRow && (
        <Text as="p" tone="faint" size="xs">
          {elementBreadcrumb(threeWay.ours, finding.subjectId)}
        </Text>
      )}
      <div className={styles.columns}>
        <FactColumn label="Base" fact={field?.base} />
        <FactColumn label="This change" fact={field?.ours} />
        <FactColumn label="Main now" fact={field?.theirs} />
      </div>
      {canReview ? (
        <>
          <div className={styles.actionsRow}>
            <Button variant={choice?.action === 'keep-ours' ? 'primary' : 'secondary'} onClick={() => { onChoose({ subjectId: finding.subjectId, attribute, action: 'keep-ours' }); }}>
              Keep this change
            </Button>
            <Button variant={choice?.action === 'keep-theirs' ? 'primary' : 'secondary'} onClick={() => { onChoose({ subjectId: finding.subjectId, attribute, action: 'keep-theirs' }); }}>
              Keep main
            </Button>
            {choice && (
              <Button variant="ghost" onClick={() => { onClear(finding.subjectId, attribute); }}>
                Clear
              </Button>
            )}
          </div>
          <div className={styles.customValueRow}>
            <input
              className={styles.input}
              type="text"
              placeholder="Enter a value…"
              value={customValue}
              onChange={(e) => {
                setCustomValue(e.target.value);
              }}
            />
            <Button
              variant={choice?.action === 'value' ? 'primary' : 'secondary'}
              disabled={customValue.trim().length === 0}
              onClick={() => {
                onChoose({ subjectId: finding.subjectId, attribute, action: 'value', value: customValue });
              }}
            >
              Use this value
            </Button>
          </div>
          {choice && (
            <Text as="p" tone="muted" size="sm">
              Staged: {choice.action === 'keep-ours' ? 'keep this change' : choice.action === 'keep-theirs' ? 'keep main' : `use "${formatFactValue(choice.value)}"`} — applies on the next refresh.
            </Text>
          )}
        </>
      ) : (
        <Text as="p" tone="muted" size="sm">
          Only a contributor on this change can resolve this.
        </Text>
      )}
    </li>
  );
}

function IdentityWarningCard({ finding, heads, dismissed, onDismiss }: { finding: ConflictFinding; heads: readonly Head[]; dismissed: boolean; onDismiss: () => void }) {
  if (dismissed) return null;
  return (
    <li className={styles.card}>
      <div className={styles.cardTitle}>
        <Chip tone="info">{finding.class === 'identity:strong' ? 'identity (strong)' : 'identity'}</Chip>
        <Text as="span" size="lg">
          {subjectName(heads, finding.subjectId)}
        </Text>
        {finding.relatedSubjectId && (
          <>
            <Text as="span" tone="muted">
              ↔
            </Text>
            <Text as="span" size="lg">
              {subjectName(heads, finding.relatedSubjectId)}
            </Text>
          </>
        )}
      </div>
      <Text as="p" size="sm">
        {finding.detail}
      </Text>
      <Button variant="ghost" onClick={onDismiss}>
        Keep both
      </Button>
    </li>
  );
}

function CleanChanges({ base, ours, cleanIds }: { base: Head; ours: Head; cleanIds: readonly UUID[] }) {
  const diff = computeVersionDiff(base, ours);
  const cleanIdSet = new Set(cleanIds);
  const elements = diff.elements.filter((e) => cleanIdSet.has(e.elementId) && e.state !== 'unchanged');
  const relationships = diff.relationships.filter((r) => cleanIdSet.has(r.relationshipId) && r.state !== 'unchanged');

  if (elements.length === 0 && relationships.length === 0) {
    return <EmptyState>No clean changes — every touched subject has a conflict or warning above.</EmptyState>;
  }

  return (
    <ul className={styles.subjectList}>
      {elements.map((e) => (
        <li key={e.elementId}>
          <DiffBadge state={e.state} changedCount={e.changedAttributes.length} />{' '}
          <Text as="span">{(e.toBe ?? e.asIs)?.name ?? e.elementId}</Text>
          {e.changedAttributes.length > 0 && (
            <Text as="span" tone="muted" size="sm">
              {' '}
              ({e.changedAttributes.join(', ')})
            </Text>
          )}
        </li>
      ))}
      {relationships.map((r) => (
        <li key={r.relationshipId}>
          <DiffBadge state={r.state} changedCount={r.changedAttributes.length} />{' '}
          <Text as="span">{(r.toBe ?? r.asIs)?.relationshipType ?? r.relationshipId}</Text>
        </li>
      ))}
    </ul>
  );
}
