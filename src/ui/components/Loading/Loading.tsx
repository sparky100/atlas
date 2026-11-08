import { Text } from '../Text/Text';
import styles from './Loading.module.css';

/** The one "still loading" placeholder: the familiar "Loading…" word (screen readers and tests rely on it) over a few quiet bars that hold the space the content will take, so the page doesn't jump when it arrives. */
export function Loading() {
  return (
    <div role="status" className={styles.loading}>
      <Text tone="muted">Loading…</Text>
      <div className={styles.bars} aria-hidden="true">
        <span className={styles.bar} />
        <span className={styles.bar} />
        <span className={styles.bar} />
      </div>
    </div>
  );
}
