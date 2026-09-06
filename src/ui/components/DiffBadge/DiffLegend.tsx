import { DiffBadge } from './DiffBadge';
import { Text } from '../Text/Text';
import styles from './DiffLegend.module.css';

/**
 * §6.3's "legend... lists the states with their markers, so the encoding
 * is always on screen." Spec describes this pinned bottom-left over a
 * canvas; this page is a plain scrolling list (src/ui/versions/
 * VersionDiffView.tsx's own comment on why), so it renders at the top
 * instead — same content, adapted position for a non-canvas surface.
 */
export function DiffLegend() {
  return (
    <div className={styles.legend}>
      <Text as="span" size="sm" tone="muted">
        Legend:
      </Text>
      <DiffBadge state="added" />
      <DiffBadge state="removed" />
      <DiffBadge state="changed" />
      <DiffBadge state="moved" />
    </div>
  );
}
