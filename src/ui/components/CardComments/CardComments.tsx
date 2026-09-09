import { useState } from 'react';
import type { UUID } from '../../../contracts/delta';
import type { AnchorType, MemberRole } from '../../../db/types';
import { CommentsSection } from '../CommentsSection/CommentsSection';
import { Text } from '../Text/Text';
import styles from './CardComments.module.css';

export interface CardCommentsProps {
  orgId: UUID;
  modelId: UUID;
  userId: UUID | null;
  role: MemberRole | null;
  anchorType: AnchorType;
  anchorId: UUID;
  branchId?: UUID | null;
  /** `undefined` while the batched count for this card's own anchor hasn't loaded yet — rendered the same as 0, never a spinner (the count is advisory, not a gate on anything). */
  unresolvedCount: number | undefined;
}

/**
 * The per-subject comments affordance on a conflict/clean-change card
 * (Sprint M1b, `docs/HANDOFF-M1b-comments.md`'s 6b: "Row affordance is the
 * marker plus 'N unresolved'. Resolving happens in place — the card's
 * count decrements, the thread collapses, the page does not navigate."). A
 * plain expand/collapse in place — no navigation, no side panel — wrapping
 * the same `CommentsSection` every other surface uses.
 */
export function CardComments({ orgId, modelId, userId, role, anchorType, anchorId, branchId, unresolvedCount }: CardCommentsProps) {
  const [open, setOpen] = useState(false);
  const count = unresolvedCount ?? 0;

  return (
    <div className={styles.wrapper}>
      <button type="button" className={styles.toggle} onClick={() => { setOpen((o) => !o); }} aria-expanded={open}>
        <Text as="span" size="sm" tone={count > 0 ? 'default' : 'muted'}>
          {count > 0 ? `💬 ${String(count)} unresolved` : '💬 no comments'}
        </Text>
      </button>
      {open && (
        <div className={styles.panel}>
          <CommentsSection orgId={orgId} modelId={modelId} userId={userId} role={role} anchorType={anchorType} anchorId={anchorId} branchId={branchId ?? null} viewKind={null} />
        </div>
      )}
    </div>
  );
}
