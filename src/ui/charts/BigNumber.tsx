/**
 * ADR-027 (F14 step 6a): a headline figure with an optional plain-words
 * comparison under it. Given `of`, it also draws a thin meter of the share,
 * with the share in text beside it (colour is never the only signal).
 */
import styles from './charts.module.css';

export interface BigNumberProps {
  label: string;
  value: string | number;
  note?: string | undefined;
  /** The whole the value is a share of, e.g. every element in the model. */
  of?: { total: number; noun: string } | undefined;
}

export function BigNumber({ label, value, note, of }: BigNumberProps) {
  const share = of !== undefined && typeof value === 'number' && of.total > 0 ? Math.min(1, value / of.total) : null;
  return (
    <div className={styles.big}>
      <span className={styles.bigLabel}>{label}</span>
      <span className={styles.bigValue}>{value}</span>
      {share !== null && of !== undefined && (
        <>
          <span className={styles.meter} aria-hidden="true">
            <span className={styles.meterFill} style={{ width: `${String(share * 100)}%` }} />
          </span>
          <span className={styles.bigNote}>
            {`${String(Math.round(share * 1000) / 10)}% of ${String(of.total)} ${of.noun}`}
          </span>
        </>
      )}
      {note !== undefined && <span className={styles.bigNote}>{note}</span>}
    </div>
  );
}
