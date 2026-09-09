import type { UUID } from '../../../contracts/delta';
import type { AnchorType, MemberRole, ViewKind } from '../../../db/types';
import { CommentsSection } from '../CommentsSection/CommentsSection';
import { Chip } from '../Chip/Chip';
import { Text } from '../Text/Text';
import styles from './CommentsPanel.module.css';

export interface CommentsPanelProps {
  orgId: UUID;
  modelId: UUID;
  userId: UUID | null;
  role: MemberRole | null;
  anchorType: AnchorType;
  anchorId: UUID;
  /** The subject's own name, for the panel header — the handoff's "a comment must always say what it is attached to" (`docs/HANDOFF-M1b-comments.md`'s Intent). */
  subjectName: string;
  unresolvedCount: number;
  branchId?: UUID | null | undefined;
  viewKind?: ViewKind | null | undefined;
  /** Focuses the new-thread composer on open — the `n` shortcut's own "New comment on the focused row" (UI-principles §8.8). */
  autoFocusComposer?: boolean;
  onClose: () => void;
}

/**
 * The canvas's own comments panel (Sprint M1b, direction 5a): 372px,
 * right side, reflowing the canvas rather than covering it (the caller's
 * own layout, not this component, does the reflow — see `LandscapePage`'s
 * flex row). Wraps `CommentsSection` rather than reimplementing threads —
 * the handoff's own words: "the canvas panel (5a) wraps this same
 * component rather than reimplementing it."
 */
export function CommentsPanel({ orgId, modelId, userId, role, anchorType, anchorId, subjectName, unresolvedCount, branchId, viewKind, autoFocusComposer = false, onClose }: CommentsPanelProps) {
  return (
    <div className={styles.panel} role="complementary" aria-label={`Comments on ${subjectName}`}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <Text as="span" size="sm" tone="muted">
            Comments · anchor: {anchorType}
          </Text>
          <Text as="h2" size="lg">
            {subjectName}
          </Text>
        </div>
        {unresolvedCount > 0 && <Chip tone="neutral">{unresolvedCount} unresolved</Chip>}
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close comments panel">
          ×
        </button>
      </div>
      <div className={styles.body}>
        <CommentsSection orgId={orgId} modelId={modelId} userId={userId} role={role} anchorType={anchorType} anchorId={anchorId} branchId={branchId ?? null} viewKind={viewKind ?? null} autoFocusComposer={autoFocusComposer} />
      </div>
    </div>
  );
}
