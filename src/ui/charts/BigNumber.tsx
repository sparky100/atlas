/** ADR-027 (F14 step 6a): a headline figure with an optional plain-words comparison under it. */
import styles from './charts.module.css';

export function BigNumber({ label, value, note }: { label: string; value: string | number; note?: string | undefined }) {
  return (
    <div className={styles.big}>
      <span className={styles.bigLabel}>{label}</span>
      <span className={styles.bigValue}>{value}</span>
      {note !== undefined && <span className={styles.bigNote}>{note}</span>}
    </div>
  );
}
