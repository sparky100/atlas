import type { ElementsHeadRow, FactsRow } from '../../../contracts/rows';
import type { UUID } from '../../../contracts/delta';
import type { BranchRow } from '../../../db/types';
import { useElementRetract } from '../../elements/useElementRetract';
import { Button } from '../Button/Button';
import { Text } from '../Text/Text';
import styles from './CapabilityRetractAction.module.css';

export interface CapabilityRetractActionProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  /** Which branch retract commits to — see useElementEditor.ts's `branch` doc comment (Sprint C1). */
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  /** Whether the element is a leaf with no live relationships — the only shape `element.retract` can express without a cascade (C8, see useElementRetract's own comment). Retract is hidden, not shown disabled, otherwise. */
  canRetract: boolean;
  onChanged: () => void;
}

/**
 * The tailoring flow's "delete" action (Sprint U2 step 2), shown only for
 * capability elements — owner/architect at `main`, the same gate as
 * `Edit` (ADR-015). A real `window.confirm()` gates it (CLAUDE.md rule 7:
 * no stand-in confirmation UI).
 *
 * Renamed from `CapabilityTailoringActions` (Sprint U4-1 D3): this used
 * to bundle "Rename" alongside Retract, sitting as a standalone row
 * between the header and Attributes — exactly the "stray control" the
 * sprint item names. Rename moved into `ElementHeader.tsx` itself
 * (its own header menu / inline title-edit, `useElementRename` now
 * instantiated in `ElementPage.tsx` and passed down there instead);
 * Retract stays here, alone, since D3 only ever asked to move rename —
 * a single, clearly-purposed destructive action isn't the clutter the
 * item was naming.
 */
export function CapabilityRetractAction({ modelId, orgId, userId, element, facts, branch, expectedHeadCommitId, canRetract, onChanged }: CapabilityRetractActionProps) {
  const retract = useElementRetract({ modelId, orgId, userId, element, facts, branch, expectedHeadCommitId, onRetracted: onChanged });

  function confirmRetract(): void {
    if (window.confirm(`Retract "${element.name}"? This removes it from the model — it can be restored later, but it will disappear from every view until then.`)) {
      void retract.retract();
    }
  }

  if (!canRetract) return null;

  return (
    <div className={styles.actions}>
      <Button variant="ghost" onClick={confirmRetract} disabled={retract.status === 'retracting'}>
        {retract.status === 'retracting' ? 'Retracting…' : 'Retract'}
      </Button>
      {retract.error !== null && (
        <Text as="p" tone="default">
          {retract.error}
        </Text>
      )}
    </div>
  );
}
