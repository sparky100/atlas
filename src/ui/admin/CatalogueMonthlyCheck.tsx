import { useEffect, useState } from 'react';
import { checkRunStatusLabel, type CheckRunRow, type CheckSchedule } from '../../contracts/catalogueAdmin';
import { getCheckSchedule, listCheckRuns, setCheckSchedule } from '../../db/catalogueAdmin';
import { supabase } from '../supabaseClient';
import { checkRunSentence, formatDay } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';
import { errorText } from './adminErrorText';

/**
 * The "Monthly check" section of Waiting for review (step 5b-2): the on/off
 * switch, with who last changed it, and the latest runs of the link and claim
 * checks, started by a person or by the monthly job. It starts switched off.
 * The monthly check only flags: it never edits a claim or unpublishes anything.
 */
export function CatalogueMonthlyCheck({ refreshKey }: { refreshKey: number }) {
  const [schedule, setSchedule] = useState<CheckSchedule | null>(null);
  const [runs, setRuns] = useState<CheckRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [nextSchedule, nextRuns] = await Promise.all([getCheckSchedule(supabase), listCheckRuns(supabase)]);
        setSchedule(nextSchedule);
        setRuns(nextRuns);
        setError('');
      } catch (cause) {
        setError(errorText(cause));
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshKey]);

  const toggle = async (enabled: boolean) => {
    setBusy(true); setError('');
    try {
      await setCheckSchedule(supabase, enabled);
      setSchedule(await getCheckSchedule(supabase));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.panel} aria-label="Monthly check" data-testid="monthly-check">
      <div className={styles.panelHeader}>
        <div>
          {loading ? <p>Loading…</p> : schedule === null ? null : (
            <>
              <label className={styles.checkLine}>
                <input type="checkbox" checked={schedule.enabled} disabled={busy} onChange={(event) => { void toggle(event.target.checked); }} /> Check source links and claims every month
              </label>
              <p data-testid="monthly-check-state">
                {schedule.enabled ? 'On' : 'Off'}
                {schedule.switchedByName !== null && schedule.switchedAt !== null ? `: switched ${schedule.enabled ? 'on' : 'off'} by ${schedule.switchedByName} on ${formatDay(schedule.switchedAt)}.` : '. It has not been switched on yet.'}
                {' '}It runs in the first days of the month, reads the claims that have no check from the last 25 days, uses the platform AI key within a daily limit, and only flags what it finds. Flagged claims appear below, and published products stay as they are until a person acts.
              </p>
            </>
          )}
        </div>
      </div>
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {!loading && error === '' && (
        runs.length === 0 ? <p data-testid="check-runs-empty">No checks have been run yet.</p> : (
          <div data-testid="check-runs">
            <h3>Latest checks</h3>
            {runs.map((run) => (
              <div key={run.id} className={styles.queueClaim}>
                <p>
                  <strong>{formatDay(run.startedAt)}</strong>: {run.kind === 'monthly' ? 'Monthly check' : `Started by ${run.startedByName ?? 'a platform admin'}`}. {checkRunStatusLabel(run.status)}.
                </p>
                <small>{checkRunSentence(run)}</small>
                {run.note !== null && <small>{run.note}</small>}
              </div>
            ))}
          </div>
        )
      )}
    </section>
  );
}
