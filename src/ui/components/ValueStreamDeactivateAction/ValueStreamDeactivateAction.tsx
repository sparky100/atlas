import { useId, useState } from 'react';
import type { ElementsHeadRow, FactsRow } from '../../../contracts/rows';
import type { UUID } from '../../../contracts/delta';
import type { BranchRow } from '../../../db/types';
import { useValueStreamDeactivate } from '../../valueStreams/useValueStreamDeactivate';
import { Button } from '../Button/Button';
import { Text } from '../Text/Text';
import styles from './ValueStreamDeactivateAction.module.css';

export interface ValueStreamDeactivateActionProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  /** Which of the two `ElementHeader.tsx` actions opened this panel — a stream currently inactive offers `reactivate`, otherwise `deactivate` (`ElementPage.tsx`'s own gate), so this component never needs to branch on the element's own current flag itself. */
  mode: 'deactivate' | 'reactivate';
  onChanged: () => void;
  onCancel: () => void;
}

/**
 * ADR-023/F6's "a stream is deactivated, never deleted" — the one small
 * panel for both directions, `RetireAction.tsx`'s own inline-panel shape.
 * Deactivating requires a reason (the whole point of recording one, same
 * as `RetireAction.tsx`'s own required planned end); reactivating needs no
 * input at all, just a confirmation.
 */
export function ValueStreamDeactivateAction({ modelId, orgId, userId, element, facts, branch, expectedHeadCommitId, mode, onChanged, onCancel }: ValueStreamDeactivateActionProps) {
  const [reason, setReason] = useState('');
  const reasonId = useId();
  const { status, error, deactivate, reactivate } = useValueStreamDeactivate({ modelId, orgId, userId, element, facts, branch, expectedHeadCommitId, onChanged });
  const busy = status === 'saving';

  if (mode === 'reactivate') {
    return (
      <div className={styles.panel}>
        <Text as="p" size="sm">
          Reactivate &ldquo;{element.name}&rdquo;? It returns to the primary Value streams list.
        </Text>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => void reactivate()} disabled={busy}>
            {busy ? 'Saving…' : 'Reactivate'}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
        {error !== null && <Text as="p">{error}</Text>}
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <Text as="p" size="sm">
        Deactivate &ldquo;{element.name}&rdquo;? It moves to the collapsed Inactive section on the Value streams page — nothing is deleted, and this is fully reversible.
      </Text>
      <label htmlFor={reasonId}>
        <Text as="span" size="sm" tone="muted">
          Reason
        </Text>
      </label>
      <input
        id={reasonId}
        type="text"
        className={styles.input}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
        }}
      />
      <div className={styles.actions}>
        <Button variant="primary" onClick={() => void deactivate(reason)} disabled={busy || reason.trim() === ''}>
          {busy ? 'Saving…' : 'Deactivate'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
      {error !== null && <Text as="p">{error}</Text>}
    </div>
  );
}
