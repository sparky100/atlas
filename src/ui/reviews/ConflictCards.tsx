import { useState } from 'react';
import type { ReactNode } from 'react';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { DiffBadge } from '../components/DiffBadge/DiffBadge';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import type { FactRow, Head } from '../../engine/deltas';
import type { ConflictFinding } from '../../engine/merge';
import type { FieldConflictChoice } from '../../engine/mergeResolution';
import type { ThreeWayDiff } from '../../engine/branch';
import { computeVersionDiff } from '../../engine/versionDiff';
import { elementBreadcrumb, subjectName } from './elementBreadcrumb';
import { formatFactValue } from './factValueFormat';
import styles from './ConflictCards.module.css';

/**
 * The conflict-finding cards SPEC §7.4 describes, rendered with the full
 * three-way context — shared between the review request's own page
 * (src/ui/reviews/ReviewRequestView.tsx) and a draft branch's own "rebase
 * on main" panel (src/ui/reviews/BranchRebasePanel.tsx, Sprint C1 step 8):
 * both show the exact same findings for the exact same branch/main pair,
 * one before a merge request exists, one after — no reason for the cards
 * themselves, or their one-click field-conflict resolution, to differ.
 */

export function StructuralConflictCard({ finding, heads, commentsSlot }: { finding: ConflictFinding; heads: readonly Head[]; commentsSlot?: ReactNode }) {
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
      {commentsSlot}
    </li>
  );
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

export interface FieldConflictCardProps {
  finding: ConflictFinding;
  threeWay: ThreeWayDiff;
  /** Contributor+ on this change — false renders the card read-only (a viewer, or someone looking at a change that isn't theirs to resolve). */
  canResolve: boolean;
  choice: FieldConflictChoice | undefined;
  onChoose: (choice: FieldConflictChoice) => void;
  onClear: (subjectId: UUID, attribute: string) => void;
  commentsSlot?: ReactNode;
}

export function FieldConflictCard({ finding, threeWay, canResolve, choice, onChoose, onClear, commentsSlot }: FieldConflictCardProps) {
  const [customValue, setCustomValue] = useState('');
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
      {canResolve ? (
        <>
          <div className={styles.actionsRow}>
            <Button
              variant={choice?.action === 'keep-ours' ? 'primary' : 'secondary'}
              onClick={() => {
                onChoose({ subjectId: finding.subjectId, attribute, action: 'keep-ours' });
              }}
            >
              Keep this change
            </Button>
            <Button
              variant={choice?.action === 'keep-theirs' ? 'primary' : 'secondary'}
              onClick={() => {
                onChoose({ subjectId: finding.subjectId, attribute, action: 'keep-theirs' });
              }}
            >
              Keep main
            </Button>
            {choice && (
              <Button
                variant="ghost"
                onClick={() => {
                  onClear(finding.subjectId, attribute);
                }}
              >
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
      {commentsSlot}
    </li>
  );
}

export function IdentityWarningCard({
  finding,
  heads,
  dismissed,
  onDismiss,
  commentsSlot,
}: {
  finding: ConflictFinding;
  heads: readonly Head[];
  dismissed: boolean;
  onDismiss: () => void;
  commentsSlot?: ReactNode;
}) {
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
      {commentsSlot}
    </li>
  );
}

export function CleanChanges({ base, ours, cleanIds, commentsSlotFor }: { base: Head; ours: Head; cleanIds: readonly UUID[]; commentsSlotFor?: (subjectId: UUID) => ReactNode }) {
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
          {commentsSlotFor?.(e.elementId)}
        </li>
      ))}
      {relationships.map((r) => (
        <li key={r.relationshipId}>
          <DiffBadge state={r.state} changedCount={r.changedAttributes.length} />{' '}
          <Text as="span">{(r.toBe ?? r.asIs)?.relationshipType ?? r.relationshipId}</Text>
          {commentsSlotFor?.(r.relationshipId)}
        </li>
      ))}
    </ul>
  );
}
