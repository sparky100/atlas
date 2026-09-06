import type { ElementsHeadRow, FactsRow } from '../../../contracts/rows';
import type { UUID } from '../../../contracts/delta';
import { useElementRename } from '../../elements/useElementRename';
import { useElementRetract } from '../../elements/useElementRetract';
import { Button } from '../Button/Button';
import { Text } from '../Text/Text';
import styles from './CapabilityTailoringActions.module.css';

export interface CapabilityTailoringActionsProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  expectedHeadCommitId: UUID;
  /** Whether the element is a leaf with no live relationships — the only shape `element.retract` can express without a cascade (C8, see useElementRetract's own comment). Retract is hidden, not shown disabled, otherwise. */
  canRetract: boolean;
  onChanged: () => void;
}

/**
 * The tailoring flow's "rename" and "delete" actions (Sprint U2 step 2),
 * shown only for capability elements — owner/architect at `main`, the same
 * gate as `Edit` (ADR-015). A real `window.confirm()` gates retract
 * (CLAUDE.md rule 7: no stand-in confirmation UI); rename records the old
 * name as an alias before it commits (useElementRename's own comment
 * explains why that ordering matters).
 */
export function CapabilityTailoringActions({ modelId, orgId, userId, element, facts, expectedHeadCommitId, canRetract, onChanged }: CapabilityTailoringActionsProps) {
  const rename = useElementRename({ modelId, orgId, userId, element, facts, expectedHeadCommitId, onSaved: onChanged });
  const retract = useElementRetract({ modelId, orgId, userId, element, facts, expectedHeadCommitId, onRetracted: onChanged });

  function confirmRetract(): void {
    if (window.confirm(`Retract "${element.name}"? This removes it from the model — it can be restored later, but it will disappear from every view until then.`)) {
      void retract.retract();
    }
  }

  if (rename.status !== 'idle') {
    return (
      <div className={styles.renameForm}>
        <input
          className={styles.input}
          type="text"
          value={rename.value}
          onChange={(e) => {
            rename.setValue(e.target.value);
          }}
        />
        <Button variant="primary" onClick={() => void rename.save()} disabled={rename.status === 'submitting'}>
          {rename.status === 'submitting' ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="ghost" onClick={rename.cancelRenaming} disabled={rename.status === 'submitting'}>
          Cancel
        </Button>
        {rename.submitError !== null && (
          <Text as="p" tone="default">
            {rename.submitError}
          </Text>
        )}
      </div>
    );
  }

  return (
    <div className={styles.actions}>
      <Button variant="ghost" onClick={rename.startRenaming}>
        Rename
      </Button>
      {canRetract && (
        <Button variant="ghost" onClick={confirmRetract} disabled={retract.status === 'retracting'}>
          {retract.status === 'retracting' ? 'Retracting…' : 'Retract'}
        </Button>
      )}
      {retract.error !== null && (
        <Text as="p" tone="default">
          {retract.error}
        </Text>
      )}
    </div>
  );
}
