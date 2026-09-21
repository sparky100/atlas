import type { ElementType, UUID } from '../../../contracts/delta';
import type { ElementsHeadRow } from '../../../contracts/rows';
import type { BranchRow } from '../../../db/types';
import { useSiblingReorder } from '../../elements/useSiblingReorder';
import { Text } from '../Text/Text';
import styles from './ReorderButtons.module.css';

/** Everything `useSiblingReorder` needs beyond the row itself — the caller's own "does the caller have edit rights, and what do we need to commit through them" shape (Sprint U4-1 C1, generalised by F6/ADR-023 — `CapabilityMapView.tsx`'s own former `CapabilityMapEditContext & { onReordered }` is exactly this same shape). */
export interface ReorderButtonsContext {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onReordered: () => void;
}

export interface ReorderButtonsProps {
  /** F6/ADR-023: lifted out of `CapabilityMapView.tsx` (Sprint U4-1 C1's own "drag-to-reorder among siblings" — buttons, not a mouse drag, see `useSiblingReorder`'s own module comment for why) so a value-stream stage's own reorder control (`ValueStreamStagesSection.tsx`) can reuse it rather than re-implementing the same up/down-button-plus-swap shape a second time. */
  elementType: ElementType;
  element: ElementsHeadRow;
  previous: ElementsHeadRow | undefined;
  next: ElementsHeadRow | undefined;
  /** The full sibling group in display order — `useSiblingReorder`'s own `swap`/`resolveOrders` comment explains why this is what lets a swap succeed even when `element` or its neighbor has no `order` yet, instead of refusing. */
  siblings: readonly ElementsHeadRow[];
  context: ReorderButtonsContext;
}

export function ReorderButtons({ elementType, element, previous, next, siblings, context }: ReorderButtonsProps) {
  const { status, error, swap } = useSiblingReorder({ elementType, ...context });

  return (
    <span className={styles.reorderButtons}>
      <button type="button" aria-label={`Move ${element.name} up`} disabled={previous === undefined || status === 'reordering'} onClick={() => { if (previous) void swap(element, previous, siblings); }}>
        ↑
      </button>
      <button type="button" aria-label={`Move ${element.name} down`} disabled={next === undefined || status === 'reordering'} onClick={() => { if (next) void swap(element, next, siblings); }}>
        ↓
      </button>
      {error !== null && (
        <Text as="span" size="xs">
          {error}
        </Text>
      )}
    </span>
  );
}
